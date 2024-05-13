// Agent service operations: managing an agent with memory

/* agentModel
const Agent = new mongoose.Schema({
  name: { type: String, required: true, max: 100 },
  description: { type: String, required: true },
  context: { type: String, required: true },
  memory: { type: String, required: true },
});
*/

class AgentService {
  constructor(agentModel, conversationService, messageService) {
    this.agentModel = agentModel;
    this.conversationService = conversationService;
    this.messageService = messageService;
  }

  async getAgentAll() {
    return await this.agentModel.find();
  }

  async getAgent(agent_id) {
    return await this.agentModel.findById(agent_id);
  }

  async createAgent(name, description, context, start_memory = '') {
    const new_agent = {
      name,
      description,
      context,
      memory: start_memory,
    };
    const db_entry = await new this.agentModel(new_agent).save();

    // Return entry to user
    return { db_entry };
  }

  async teachAgent(agent_id, messages, user_id, category) {
    // Load agent
    const agent = await this.agentModel.findById(agent_id);
    // Generate prompt message
    const memory_query = [];
    memory_query.push({
      role: 'system',
      content: [
        { type: 'text', text: `Your task is to summarize the facts from our conversation, for reference in future conversations.` }
      ]
    });
    messages.forEach(m => {
      if(m.role === 'system') {
        memory_query[0].content[0].text += "\n\n---\n\n" + m.content[0].text;
      } else {
        memory_query.push(m);
      }
    });
    memory_query.push({
      role: 'user',
      content: [
        { type: 'text', text: `${agent.memory.length > 0 ? "This is the current reference message, that needs to be updated:\n\n---\n\n" + agent.memory + "\n\n---\n\n" : ""}Based on the previously defined tasks which are "${agent.context}", please provide a summary of the conversation. Focus on extracting and summarizing key details directly relevant to these tasks. Include all resolved facts and final decisions, and also provide expanded details for parts of the conversation that critically inform the understanding of the context and implications pertaining to these tasks. Ensure that the summary is concise yet comprehensive enough to capture all necessary insights related to the designated tasks.` }
      ]
    });
    const memory_response = await this.messageService.createMessage(true, memory_query, null, user_id, {category, tags: "agent_memory", prompt: memory_query[memory_query.length-1].content[0].text}, []);
    // Update agent memory
    agent.memory = memory_response.db_entry.response;
    await agent.save();
    // Return updated memory
    return memory_response.db_entry.response;
  }

  async askAgent(conversation_id, agent_id, messages, user_id, category) {
    // Load agent
    const agent = await this.agentModel.findById(agent_id);
    // Append agent context and memory to messages
    const query_messages = [];
    query_messages.push({
      role: 'system',
      content: [
        { type: 'text', text: `${agent.context}${agent.memory.length > 0 ? "\n\n---\n\n" + agent.memory : ""}` }
      ]
    });
    messages.forEach(m => {
      if(m.role === 'system') {
        query_messages[0].content[0].text += "\n\n---\n\n" + m.content[0].text;
      } else {
        query_messages.push(m);
      }
    });
    // Query message API
    const response = await this.messageService.createMessage(true, query_messages, null, user_id, {category, tags: "agent", prompt: query_messages[query_messages.length-1].content[0].text}, []);
    // Append message to conversation
    await this.conversationService.appendMessageToConversation(conversation_id, response.db_entry._id.toString());
    // Return agent response
    return response.db_entry.response;
  }

  async queryAgent(agent_id, start_context, prompt, user_id, tags, title, category) {
    // Load agent
    const agent = await this.agentModel.findById(agent_id);
    const parameters = {
      context: `${start_context.length > 0 ? start_context+"\n\n" : ""}In your response, use the provided 'memory' content as a reference to ensure your answers are aligned with the information previously provided. Answer the user query precisely based on the 'memory'. If the user query asks for suggestions or ideas, you may include those additionally, even if not directly mentioned in the 'memory'. Your response should be well-structured and clear. Avoid introducing facts that are not supported by the 'memory' unless specifically asked for ideas or suggestions.`,
      prompt: `**Memory:**\n\n${agent.memory}\n\n---\n\n**Query:**\n\n${prompt}`,
      tags,
      title,
      category,
    };
    const conversation_id = await this.conversationService.postToConversation(user_id, "new", [], parameters);
    return conversation_id;
  }
}

module.exports = AgentService;