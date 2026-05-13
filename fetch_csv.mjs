import fetch from 'node-fetch';
async function run() {
  const res = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ5AqtIOOwuBZnyb3L7hd-11U2EoEIL8pkJyCPcT3qlPej5Y1-OGJxpKtvOdWSfVmsInZFR2SQNwU4/pub?gid=1846778885&single=true&output=csv');
  const text = await res.text();
  console.log(text.slice(0, 500));
}
run();
