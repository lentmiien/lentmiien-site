// Below functions should output a string, suitable for injection in context to LLM model

const cooking_recipe = (version, data) => {
  const j_data = JSON.parse(data);

  if (version === 1 || version === 2) {
    // V1 & V2
    /*
    name:Text:true:true
    ingredients:Text:true:true
    instructions:Text:true:true
    portions:Number:true:false
    time:Number:true:false
    note:Text:true:true
    url:Text:false:false  <-- V2 only
    image:Text:false:false
    */
    return `## ${j_data.name}\n\n**Portions:** ${j_data.portions}\n\n${j_data.ingredients}\n\n${j_data.instructions}\n\n${j_data.note}`;
  }

  // Return empty sdtring if invalid version
  return "";
};

const information = (version, data) => {
  const j_data = JSON.parse(data);

  if (version === 1) {
    // V1
    /*
    text:Text:true:true
    */
    return j_data.text;
  }

  // Return empty sdtring if invalid version
  return "";
};

module.exports = {
  "Cooking recipe": cooking_recipe,
  "Information": information,
};
