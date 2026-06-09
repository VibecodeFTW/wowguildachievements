const fetch = require('node-fetch');
const fs = require('fs');

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BLIZZARD_CLIENT_ID = process.env.BLIZZARD_CLIENT_ID;
const BLIZZARD_CLIENT_SECRET = process.env.BLIZZARD_CLIENT_SECRET;
const GUILD_NAME = process.env.GUILD_NAME;
const REALM = process.env.REALM;
const REGION = process.env.REGION || 'us';

function readLastId() {
  try {
    const data = fs.readFileSync('lastAchievement.json', 'utf8');
    return JSON.parse(data).lastId;
  } catch {
    return null;
  }
}

function writeLastId(id) {
  fs.writeFileSync('lastAchievement.json', JSON.stringify({ lastId: id }, null, 2));
}

async function getAccessToken() {
  const res = await fetch(`https://${REGION}.battle.net/oauth/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: BLIZZARD_CLIENT_ID,
      client_secret: BLIZZARD_CLIENT_SECRET
    })
  });
  const data = await res.json();
  return data.access_token;
}

function formatForApi(name) {
  return name
    .toLowerCase()
    .replace(/'/g, '')       // remove apostrophes
    .replace(/\s+/g, '-')    // spaces to hyphens
    .replace(/[^a-z0-9-]/g, ''); // remove other special chars
}

async function getGuildAchievements(token) {
  const realmFormatted = formatForApi(REALM);
  const guildFormatted = formatForApi(GUILD_NAME);

  const url = `https://${REGION}.api.blizzard.com/data/wow/guild/${realmFormatted}/${guildFormatted}/achievements?namespace=profile-${REGION}&locale=en_US`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blizzard API error ${res.status}: ${text}`);
  }

  return res.json();
}


async function postToDiscord(achievement) {
  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'WoW Guild Tracker',
      embeds: [{
        title: `🎉 Guild Achievement Unlocked!`,
        description: `**${achievement.achievement.name}**\n${achievement.achievement.description}`,
        thumbnail: { url: achievement.achievement.media?.assets?.[0]?.value || '' },
        color: 0xFFD700
      }]
    })
  });
}

(async () => {
  try {
    const lastId = readLastId();
    const token = await getAccessToken();
    const data = await getGuildAchievements(token);

    if (data.achievements && data.achievements.length > 0) {
      const latest = data.achievements[0];
      if (latest.id !== lastId) {
        await postToDiscord(latest);
        writeLastId(latest.id);
        console.log(`Posted new achievement: ${latest.achievement.name}`);
      } else {
        console.log("No new achievements.");
      }
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
