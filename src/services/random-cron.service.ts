export function generateRandomDailyCronTimer(): string {
  const randomSecond = getRandomInt(0, 59);
  const randomMinute = getRandomInt(0, 59);
  const randomHour = getRandomInt(0, 24);
  return `${randomSecond} ${randomMinute} ${randomHour} * * *`;
}

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}
