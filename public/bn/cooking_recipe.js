const ids = JSON.parse(document.getElementById("ids").innerText);
const templates = JSON.parse(document.getElementById("templates").innerText);
const knows = JSON.parse(document.getElementById("knows").innerText);
const content = document.getElementById("content");
const index = document.getElementById("index");

const master_data = [];
const all_data_fields = [];

// Prepare data labels
for (let i = 0; i < templates.length; i++) {
  templates[i].dataFormat = JSON.parse(templates[i].dataFormat);
  templates[i].dataFormat.forEach(d => {
    if (all_data_fields.indexOf(d.data_label) === -1) {
      all_data_fields.push(d.data_label);
    }
  });
}
// Prepare master data
for (let i = 0; i < knows.length; i++) {
  knows[i].data = JSON.parse(knows[i].data);
  const new_data = {
    m_title: knows[i].title,
    m_chat_id: knows[i].originId,
    m_author: knows[i].author,
  };
  all_data_fields.forEach(label => {
    if (label in knows[i].data) {
      new_data[label] = knows[i].data[label];
    } else {
      new_data[label] = null;
    }
  });
  master_data.push(new_data);
}

/*
{
    "_id": "65681938401a82b3335740b6",
    "templateId": "6562e7bb5d76250d064fe480",
    "title": "Saba no Misoni",
    "createdDate": "2023-11-30T05:10:16.715Z",
    "originId": "65680e1e1da7a09bd412d927",
    "data": {
      \"name\":\"Saba no Misoni\",
      \"ingredients\":\"### Ingredients:\\r\\n\\r\\n- 4 mackerel fillets (~120 grams each), cleaned and cut into serving pieces\\r\\n- 400 ml of water\\r\\n- 80 ml of sake (Japanese rice wine)\\r\\n- 4 tablespoons of low-sodium soy sauce\\r\\n- 2 tablespoons of miso paste (preferably with reduced sodium)\\r\\n- 1 tablespoon of mirin (if unavailable, substitute with a tablespoon of sake and 1/2 teaspoon of sugar)\\r\\n- 1-2 tablespoons of grated fresh ginger\\r\\n- 200 grams daikon radish, sliced thinly\\r\\n- 2 medium carrots, sliced thinly\\r\\n- 8 shiitake mushrooms, stems removed and sliced\\r\\n- 1 leek or green onion, finely chopped (for garnish)\\r\\n- A handful of fresh greens (such as spinach or bok choy) for added fiber\",
      \"instructions\":\"### Instructions:\\r\\n\\r\\n1. **Prepare the Fish:** Pat the mackerel fillets dry with paper towels. Lightly score the skin of each fillet to prevent curling during cooking, and set them aside.\\r\\n2. **Prepare the Vegetables:** Peel and slice the daikon radish and carrots thinly. Prepare the shiitake mushrooms by removing the stems and slicing them.\\r\\n3. **Cook the Vegetables:** In a large skillet or pot, bring the water, sake, soy sauce, mirin, and grated ginger to a boil. Add the sliced daikon radish and carrots, and simmer for about 10 minutes until they start to soften.\\r\\n4. **Add the Miso:** In a bowl, thin out the miso paste with a bit of the cooking liquid, then stir it back into the pot. This prevents clumps of miso in the sauce.\\r\\n5. **Add the Mackerel:** Place the mackerel fillets in the pan, skin-side down. Spoon some of the liquid over the top of the fillets. Add the sliced shiitake mushrooms around the fillets.\\r\\n6. **Simmer:** Reduce the heat, cover the pan with a lid, and let the fish simmer for about 12 minutes. The fish is done when it flakes easily with a fork.\\r\\n7. **Remove from Heat:** Once the fish is cooked, gently remove it from the pan, being careful as it will be very tender.\\r\\n8. **Prepare the Greens:** Quick-steam or blanch the greens in boiling water for 1-2 minutes until just wilted.\\r\\n9. **Serve:** Place a portion of fish on each plate along with the cooked vegetables and steamed greens. Spoon some of the cooking liquid over each serving and garnish with chopped leeks or green onions.\\r\\n10. **Enjoy:** Serve the dish hot, accompanied by a side of brown rice or barley to increase the fiber content of the meal further.\",
      \"portions\":\"4\",
      \"time\":\"30\",
      \"note\":\"This recipe is high in omega-3 fatty acids, moderate in calories, and rich in fiber, thanks to the addition of vegetables and optional high-fiber side grains. By avoiding the use of extra oil and choosing reduced-sodium options, you help lower saturated fat intake and support a healthy waistline. Enjoy your heart-healthy, traditional Japanese meal!\",
      \"url\":\"\",
      \"image\":\"/img/image-1701318496036-.png\"
    },
    "category": "Recipe",
    "author": "Lennart",
    "__v": 0
  }
*/
function DisplayPage(num) {
  // Clear before drawing new content
  content.innerHTML = "";

  const name = document.createElement("h2");
  const chat_link = document.createElement("a");
  const br = document.createElement("br");
  const image = document.createElement("img");
  const ingredients = document.createElement("div");
  const instructions = document.createElement("div");
  const note = document.createElement("div");

  name.innerText = master_data[num].name;
  chat_link.href = `/chat3?chat=${master_data[num].m_chat_id}`;
  chat_link.innerText = "View chat"
  image.src = master_data[num].image;
  image.classList.add("image-large");
  ingredients.innerHTML = marked.parse(master_data[num].ingredients);
  instructions.innerHTML = marked.parse(master_data[num].instructions);
  note.innerHTML = marked.parse(master_data[num].note);

  content.append(name, chat_link, br, image, ingredients, instructions, note);
}

function DisplayIndex() {
  master_data.forEach((d, i) => {
    const button = document.createElement("button");
    button.classList.add("btn", "btn-link");
    if (d.image && d.image.length > 0) {
      const img = document.createElement("img");
      img.src = d.image;
      img.classList.add("button-thumbnail");
      button.append(img);
    }
    const span = document.createElement("span");
    span.innerText = d.m_title;
    button.append(span);

    button.addEventListener("click", () => DisplayPage(i));

    index.append(button);
  });
}

DisplayPage(0);
DisplayIndex();
