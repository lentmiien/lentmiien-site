const marked = require('marked');
const { chatGPT, OpenAIAPICallLog } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { Chat2Model } = require('../database');

exports.index = (req, res) => {
  // Load current database
  Chat2Model.find().then((data) => {
    // Format data and render index page (chat list and chat window)
    const chat_list = [];
    const chat_hist = [];
    const chat_id = req.query.id ? parseInt(req.query.id) : 0;
    let chat_title = '';
    let chat_model = 'gpt-3.5-turbo';
    let chat_context = '';
    let date = new Date();
    const usage = {};
    for (let i = 0; i < 12; i++) {
      const date_val = date.getFullYear() * 100 + date.getMonth() + 1;
      usage[`${date.getFullYear()}-${date.getMonth()}`] = {
        tokens: 0,
        cost: 0,
        date_val,
        date_label: utils.insertCharAt(date_val.toString(), 4, '-')
      };
      date = new Date(date.getFullYear(), date.getMonth()-1, 1);
    }

    // Parse data
    const chat_list_lookup = [];
    data.forEach((d) => {
      // Only parse data for current user
      if (d.username == req.user.name) {
        // Generate chat_list
        const index = chat_list_lookup.indexOf(d.threadid);
        if (index >= 0) {
          chat_list[index].title = d.title;
          chat_list[index].date = d.created;
        } else {
          chat_list_lookup.push(d.threadid);
          chat_list.push({
            id: d.threadid,
            title: d.title,
            date: d.created,
          });
        }

        // Generate chat_hist
        if (d.threadid == chat_id) {
          chat_hist.push({
            title: d.title,
            role: d.role,
            model: d.model,
            content: marked.parse(d.content),
            date: d.created,
            tokens: d.tokens,
          });
        }

        // Calculate usage (this month)
        const key = `${d.created.getFullYear()}-${d.created.getMonth()}`;
        if (key in usage) {
          usage[key].tokens += d.tokens;

          //  2023-08-06                         INPUT               OUTPUT
          // Calculate cost [gpt-3.5-turbo	    $0.0015/ 1K tokens  $0.002 / 1K tokens]
          // Calculate cost [gpt-3.5-turbo-16k	$0.003 / 1K tokens  $0.004 / 1K tokens]
          // Calculate cost [gpt-4	            $0.03  / 1K tokens  $0.06  / 1K tokens]
          // Calculate cost [gpt-4-32k	        $0.06  / 1K tokens  $0.12  / 1K tokens]
          // Calculate cost [Ada v2	            $0.0001/ 1K tokens]
          let multiplier = 1;
          if (d.model == 'gpt-3.5-turbo' && d.role == 'user') multiplier = 0.0015;
          if (d.model == 'gpt-3.5-turbo' && d.role == 'assistant') multiplier = 0.002;
          if (d.model == 'gpt-3.5-turbo-16k' && d.role == 'user') multiplier = 0.003;
          if (d.model == 'gpt-3.5-turbo-16k' && d.role == 'assistant') multiplier = 0.004;
          if (d.model == 'gpt-4' && d.role == 'user') multiplier = 0.03;
          if (d.model == 'gpt-4' && d.role == 'assistant') multiplier = 0.06;
          if (d.model == 'gpt-4-32k' && d.role == 'user') multiplier = 0.06;
          if (d.model == 'gpt-4-32k' && d.role == 'assistant') multiplier = 0.12;
          if (d.model == 'text-embedding-ada-002' && d.role == 'system') multiplier = 0.0001;
          usage[key].cost += d.tokens * multiplier / 1000;
        }
      }
    });

    // Sort data
    chat_list.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });
    chat_hist.sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });

    
    const keys = Object.keys(usage);
    keys.forEach(key => {
      usage[key].cost = Math.round(usage[key].cost * 100) / 100;
    });

    // Do some final updates
    if (chat_hist.length > 0) {
      chat_title = chat_hist[chat_hist.length - 1].title;
      if (chat_hist[chat_hist.length - 1].model.indexOf('gpt-4') == 0) {
        chat_model = 'gpt-4';
      }
      chat_context = chat_hist[0].content;
    }

    res.render('chat2', { usage, chat_list, chat_hist, chat_id, chat_title, chat_context, chat_model });
  });
};

/*
Form data
req.body.id      // "0" means a new chat [correspond to "threadid" in database]
req.body.title   // 
req.body.model   // 
req.body.system  // Ignore for all id other than "0"
req.body.message // 
*/
exports.post = (req, res) => {
  let id = parseInt(req.body.id);
  Chat2Model.find().then(async (data_count) => {
    if (id == 0) {
      id = data_count.length + 1;
    }
    // Change to instead filter previous requested data
    const data = data_count.filter(d => d.threadid == id);
    data.sort((a, b) => {
      if (a.created < b.created) return -1;
      if (a.created > b.created) return 1;
      return 0;
    });

    const messages = [];
    const entries_to_save = [];
    const ts_1 = Date.now() - 2000;
    const ts_2 = ts_1 + 1000;

    // Approximate number of tokens to last 2 messages, and hold a buffer of 1000 tokens to max
    let approximate_tokens = 0;
    if (data.length > 0) {
      approximate_tokens += data[data.length-1].tokens;
      approximate_tokens += data[data.length-2].tokens;
    } else {
      approximate_tokens += utils.estimateTokens(req.body.system);
    }
    approximate_tokens += utils.estimateTokens(req.body.message);
    // Update model as necessary (eg. gpt-3.5-turbo => gpt-3.5-turbo-16k)
    let model_to_use = req.body.model;
    if (approximate_tokens > 3000 && model_to_use == "gpt-3.5-turbo") {
      model_to_use = 'gpt-3.5-turbo-16k';
    }
    if (approximate_tokens > 15000 && model_to_use == "gpt-3.5-turbo-16k") {
      model_to_use = 'gpt-4-32k';
    }
    if (approximate_tokens > 7000 && model_to_use == "gpt-4") {
      model_to_use = 'gpt-4-32k';
    }

    // If a new chat, start by adding system message
    if (data.length == 0) {
      messages.push({
        role: 'system',
        content: req.body.system,
      });
      entries_to_save.push({
        title: req.body.title,
        username: req.user.name,
        role: 'system',
        model: model_to_use,
        content: req.body.system,
        created: new Date(ts_1),
        tokens: 0,
        threadid: id,
      });
    }
    // Add all existing messages from database
    for (let i = 0; i < data.length; i++) {
      messages.push({
        role: data[i].role,
        content: data[i].content,
      });
    }
    // Add new message
    messages.push({
      role: 'user',
      content: req.body.message,
    });
    entries_to_save.push({
      title: req.body.title,
      username: req.user.name,
      role: 'user',
      model: model_to_use,
      content: req.body.message,
      created: new Date(ts_2),
      tokens: 0,
      threadid: id,
    });
    // Connect to ChatGPT and get response, then add to entries_to_save
    const response = await chatGPT(messages, model_to_use);
    if (response) {
      // Save to API call log
      await OpenAIAPICallLog(req.user.name, model_to_use, response.usage.prompt_tokens, response.usage.completion_tokens, JSON.stringify(messages), response.choices[0].message.content);
      
      const user_index = entries_to_save.length - 1;
      entries_to_save[user_index].tokens = response.usage.prompt_tokens;
      console.log(`Approximated tokens: ${approximate_tokens}; Actual tokens: ${response.usage.prompt_tokens}; Error: ${approximate_tokens - response.usage.prompt_tokens}`)
      entries_to_save.push({
        title: req.body.title,
        username: req.user.name,
        role: 'assistant',
        model: model_to_use,
        content: response.choices[0].message.content,
        created: new Date(),
        tokens: response.usage.completion_tokens,
        threadid: id,
      });
      // Save to database
      Chat2Model.collection.insertMany(entries_to_save);
      setTimeout(() => res.redirect(`/chat2?id=${id}`), 100);
    } else {
      console.log('Failed to get a response from ChatGPT.');
      res.redirect(`/chat2`);
    }
  });
  // Load current database for given threadid
  // Receive a new chat message from post request
  // Put together API request and send to ChatGPT API
  // Save response to database
  // Reload index page (may need a small delay?)
};
