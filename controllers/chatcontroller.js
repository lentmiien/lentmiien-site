const { chatGPT, OpenAIAPICallLog } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { ChatModel } = require('../database');

exports.index = (req, res) => {
  // Load current database
  ChatModel.find().then((data) => {
    // Format data and render index page (chat list and chat window)
    const chat_list = [];
    const chat_hist = [];
    const chat_id = req.query.id ? parseInt(req.query.id) : 0;
    let chat_title = '';
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
          let pp_content = '';
          const parts = d.content.split('```');
          for (let i = 0; i < parts.length; i++) {
            if (i % 2 == 0) {
              pp_content += parts[i].split('\n').join('<br>');
            } else {
              pp_content += `<pre onclick="CopyCode(this)">${parts[i]}</pre>`;
            }
          }
          chat_hist.push({
            title: d.title,
            role: d.role,
            content: pp_content,
            date: d.created,
            tokens: d.tokens,
          });
        }

        // Calculate usage (this month)
        const key = `${d.created.getFullYear()}-${d.created.getMonth()}`;
        if (key in usage) {
          usage[key].tokens += d.tokens;
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

    // Calculate cost [gpt-3.5-turbo	$0.002 / 1K tokens]
    const keys = Object.keys(usage);
    keys.forEach(key => {
      usage[key].cost = Math.round((usage[key].tokens * 0.002) / 10) / 100;
    });

    // Do some final updates
    if (chat_hist.length > 0) {
      chat_title = chat_hist[chat_hist.length - 1].title;
      chat_context = chat_hist[0].content;
    }

    // Debuging stuff
    // console.log(chat_hist);

    res.render('chat', { usage, chat_list, chat_hist, chat_id, chat_title, chat_context });
  });
};

/*
Form data
req.body.id      // "0" means a new chat [correspond to "threadid" in database]
req.body.title   // 
req.body.system  // Ignore for all id other than "0"
req.body.message // 
*/
exports.post = (req, res) => {
  let id = parseInt(req.body.id);
  ChatModel.find().then(async (data_count) => {
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
      content: req.body.message,
      created: new Date(ts_2),
      tokens: 0,
      threadid: id,
    });
    // Connect to ChatGPT and get response, then add to entries_to_save
    const response = await chatGPT(messages, 'gpt-3.5-turbo');
    if (response) {
      // Save to API call log
      await OpenAIAPICallLog(req.user.name, 'gpt-3.5-turbo', response.usage.prompt_tokens, response.usage.completion_tokens, JSON.stringify(messages), response.choices[0].message.content);

      entries_to_save.push({
        title: req.body.title,
        username: req.user.name,
        role: 'assistant',
        content: response.choices[0].message.content,
        created: new Date(),
        tokens: response.usage.total_tokens,
        threadid: id,
      });
      // Save to database
      ChatModel.collection.insertMany(entries_to_save);
      setTimeout(() => res.redirect(`/chat?id=${id}`), 100);
    } else {
      console.log('Failed to get a response from ChatGPT.');
      res.redirect(`/chat`);
    }
  });
  // Load current database for given threadid
  // Receive a new chat message from post request
  // Put together API request and send to ChatGPT API
  // Save response to database
  // Reload index page (may need a small delay?)
};
