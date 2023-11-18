const marked = require('marked');
const { chatGPT, OpenAIAPICallLog } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { Chat3Model } = require('../database');

exports.index = async (req, res) => {
  const this_conversation_id = req.query.id || 0;
  let new_conversation_id = 0;

  // Load current database
  // const chat_data = await Chat3Model.find();

  // DEBUG: sample data [uncomment above row, and delete DEBUG section to stop debuging]
  /*
  ConversationID: { type: Number, required: true },
  StartMessageID: { type: String, required: true, max: 100 },
  PreviousMessageID: { type: String, required: true, max: 100 },
  ContentText: { type: String, required: true },
  ContentTokenCount: { type: Number, required: true },
  SystemPromptText: { type: String, required: true },
  UserOrAssistantFlag: { type: Boolean, required: true },
  UserID: { type: String, required: true, max: 100 },
  Title: { type: String, required: true, max: 255 },
  Timestamp: { type: Date, required: true },
  */
  const chat_data = [];
  chat_data.push({
    _id: 123001,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "root",
    ContentText: "I want to explore around the topic of the common cold, what's causing it, why and how it affects the body, as well as preventive measures and how to recover from a cold. Please start by giving me a comprehensive overview of the topic.",
    ContentTokenCount: 67,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: true,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 12, 12, 0, 0, 0),
  });
  chat_data.push({
    _id: 123002,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "123001",
    ContentText: "The common cold, also just called a cold, is a viral infection of the upper respiratory tract, primarily affecting the nose and throat. It's one of the most frequent diseases humans contract, with adults typically getting 2-3 colds a year and children even more.\n\nCauses Over 200 types of viruses can cause a cold, but most colds are caused by rhinoviruses. These viruses are airborne and can be inhaled directly or picked up from surfaces like doorknobs or telephones and transferred to the nose or mouth. Colds are most commonly spread from person to person through respiratory droplets in the air when a person with a cold coughs or sneezes.\n\nEffects on the body When you catch a cold virus, it attaches to the lining of your nose or throat. Your immune system perceives this virus as an invader and responds by sending white blood cells to attack. This process results in the classic symptoms of a common cold, like runny nose, congestion, and coughing. Other possible symptoms include a sore throat, mild headache, fatigue, sneezing, and a low-grade fever.\n\nPrevention Preventing a cold involves reducing exposure to cold-causing viruses and strengthening your immune system. Some measures include washing hands regularly and thoroughly, avoiding close contact with people who have a cold, not touching your face, maintaining a healthy diet, getting regular exercise, and ensuring you get good-quality sleep.\n\nRecovery The common cold typically clears up on its own within 1 to 2 weeks. Treatment focuses on relieving the symptoms and can include rest, hydration, over-the-counter cold remedies, and nasal sprays or drops. It's also important to avoid spreading the virus to others by covering your mouth when you cough or sneeze and staying home from work or school.\n\nIn some cases, the common cold can lead to complications like bronchitis or pneumonia, particularly in people with weakened immune systems or other medical conditions. It's important to seek medical care if symptoms persist beyond a week or worsen over time.\n\nWhile the common cold is often seen as a minor annoyance, understanding its causes, effects, prevention, and recovery can help manage it more effectively and maintain overall well-being.",
    ContentTokenCount: 460,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: false,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 12, 12, 0, 10, 0),
  });
  chat_data.push({
    _id: 123003,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "123002",
    ContentText: "My 3 year son brings home a cold nearly on a monthly basis, I guess from kindergarten, and avoiding close contact isn't really possible in this situation. Do you have any advice for me, for staying as healthy as possible and avoiding the worst affects of catching a cold.",
    ContentTokenCount: 64,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: true,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 12, 15, 0, 0, 0),
  });
  chat_data.push({
    _id: 123004,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "123003",
    ContentText: "It's quite common for toddlers attending daycare or kindergarten to catch colds frequently. This is because their immune systems are still developing and they are being exposed to a variety of different cold viruses for the first time. Here are some effective strategies to help you and your family stay as healthy as possible:\n\n1. Boost Your Immune System: Maintain a healthy lifestyle to better combat incoming viruses. This includes eating nutritious foods full of vitamins and minerals, getting regular exercise, ensuring adequate sleep, and staying hydrated.\n\n2. Regular Hand Washing: Children should wash their hands regularly, especially before meals, after using the bathroom, after coming from outside, and after coughing or sneezing. As a parent, it's important for you to do the same. Use warm water and soap, and scrub thoroughly for at least 20 seconds.\n\n3. Teaching Good Practices: Teach your child to sneeze or cough into a tissue or the crook of their elbow, not their hands. This can prevent the spread of viruses.\n\n4. Regular Cleaning: Clean regularly touched objects and surfaces in your home like toys, handles, or mobile devices to reduce the risk of transmission.\n\n5. Vaccination: Ensure your child's vaccinations are up-to-date. While there isn't a vaccine specifically for colds, vaccines for the flu and pneumococcal disease can help keep your child healthier overall.\n\n6. Probiotics: Some research suggests that probiotics, found in foods like yogurt or in supplement form, may help prevent colds or reduce their severity.\n\n7. Limit Touching Your Face: Touching the face, specifically the nose, eyes, and mouth, is a common way for cold viruses to enter the body. Encourage your child to avoid this and also practice it yourself.\n\nBeing exposed to cold viruses at a young age helps children build stronger immunity. The common cold is an inevitable part of childhood and, while it's hard to prevent entirely, the frequency should decrease as your child gets older and their immune system becomes more robust.\n\nRemember to seek medical advice if any cold symptoms seem particularly severe or persist for longer than usual.",
    ContentTokenCount: 435,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: false,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 12, 15, 0, 9, 0),
  });
  chat_data.push({
    _id: 123005,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "123002",
    ContentText: "Can you please explain the recovery process in details, how does the body get rid of the viruses, and how does the body recover from the symptoms?",
    ContentTokenCount: 38,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: true,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 14, 11, 0, 0, 0),
  });
  chat_data.push({
    _id: 123006,
    ConversationID: 0,
    StartMessageID: "123001",
    PreviousMessageID: "123005",
    ContentText: "Sure! The recovery process from the common cold is primarily a natural and automatic response by the body's immune system to fight off the virus. Here is what typically happens:\n\n1. Infection: Once a cold virus enters the body, it attaches to the lining of the nasal passages or throat, triggering the immune system to respond.\n\n2. Immune Response: The body detects the foreign virus and releases various immune cells to the site of infection. Among these are white blood cells such as lymphocytes and phagocytes.\n\nPhagocytes engulf and digest the invading viruses and also summon additional immune cells.\nLymphocytes (T-cells and B-cells) have two jobs: T-cells, once activated, kill virus-infected cells, and B-cells produce antibodies. Antibodies are proteins that specifically target the cold virus to neutralize it and protect against future infections by the same virus.\n\n3. Inflammation: In response to the infection, the body increases blood flow to the nasal passages, bringing more immune cells to the area. This causes the nasal passages to swell and produce mucus, which can result in a stuffy nose and make it difficult to breathe.\n\n4. Elimination of the Virus: Over time, the immune system is usually able to clear out the infection. Phagocytes continue to engulf and destroy the virus particles, while B-cells and T-cells continue to eliminate the infected cells and prevent the spread of the virus.\n\n5. Symptoms Treatment: Symptoms are treated to provide relief during the infection:\n\nDecongestants can reduce swelling in the nasal passages.\nAnalgesics like acetaminophen or ibuprofen can help manage pain or fever.\nCough suppressants and expectorants can relieve coughing.\nThroat lozenges can help soothe a sore throat.\n\n6. Recovery and Cleanup: After the infection is controlled, the symptoms begin to improve. Excess mucus and cellular debris are cleared out of the body, mainly through the process of coughing and expulsion through the nose.\n\n7. Restoration: The body's immune system begins to wind down the inflammation and repair any tissue damage that may have occurred during the infection. The immune memory cells (memory B-cells and T-cells) will remember the virus, providing an efficient and faster response if the same virus were to infect the body again.\n\nIt’s worth noting that the exact immune response and recovery process can vary from person to person, and symptoms can last anywhere from a few days to a couple of weeks. While the body is equipped to handle most cold infections on its own, ensuring proper rest, good nutrition, and staying hydrated can support the immune system's function and help speed up the recovery.",
    ContentTokenCount: 574,
    SystemPromptText: "You are a helpful assistant.",
    UserOrAssistantFlag: false,
    UserID: "Lennart",
    Title: "Cold",
    Timestamp: new Date(2023, 10, 14, 11, 0, 12, 0),
  });
  // DEBUG END

  const this_conversation = chat_data.filter(d => d.ConversationID === this_conversation_id);
  const chats = [];
  const unique_ids = [];
  chat_data.forEach(d => {
    const index = unique_ids.indexOf(d.ConversationID);
    if (index === -1) {
      unique_ids.push(d.ConversationID);
      chats.push({
        ConversationID: d.ConversationID,
        Title: d.Title,
        last_message: d.ContentText,
        last_timestamp: d.Timestamp,
      });
    } else {
      if (d.Timestamp > chats[index].last_timestamp) {
        chats[index].last_timestamp = d.Timestamp;
        chats[index].last_message = d.ContentText;
      }
    }

    // Set new_conversation_id
    if (new_conversation_id <= d.ConversationID) {
      new_conversation_id = d.ConversationID + 1;
    }
  })

  res.render("chat3", {this_conversation, chats, new_conversation_id});
};

exports.post = (req, res) => {
  let id = parseInt(req.body.id);

  // TODO: make function

  setTimeout(() => res.redirect(`/chat3?id=${id}`), 100);
};
