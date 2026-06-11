// index.js
require('dotenv').config();
const fetch = require('node-fetch');

// ---------- Config ----------
const REGION = 'us';
const LOCALE = 'en_US';
const NAMESPACE_STATIC = `static-${REGION}`;
const NAMESPACE_PROFILE = `profile-${REGION}`;

const GUILD_REALM_SLUG = process.env.GUILD_REALM_SLUG;   // e.g. 'area-52'
const GUILD_NAME_SLUG = process.env.GUILD_NAME_SLUG;     // e.g. 'my-guild'
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const BNET_CLIENT_ID = process.env.BNET_CLIENT_ID;
const BNET_CLIENT_SECRET = process.env.BNET_CLIENT_SECRET;

// ---------- Helpers ----------
async function getAccessToken() {
  const url = `https://${REGION}.battle.net/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials'
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${BNET_CLIENT_ID}:${BNET_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function apiFetch(path, token, namespace) {
  const url = `https://${REGION}.api.blizzard.com${path}${
    path.includes('?') ? '&' : '?'
  }namespace=${namespace}&locale=${LOCALE}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status} for ${url}: ${text}`);
  }

  return res.json();
}

// ---------- Blizzard API calls ----------
async function getGuildAchievements(token) {
  const path = `/data/wow/guild/${GUILD_REALM_SLUG}/${GUILD_NAME_SLUG}/achievements`;
  const data = await apiFetch(path, token, NAMESPACE_PROFILE);

  // data.achievements is usually an array of { achievement: { id }, completed_timestamp, ... }
  return data.achievements || [];
}

async function getAchievementDetails(id, token) {
  const path = `/data/wow/achievement/${id}`;
  return apiFetch(path, token, NAMESPACE_STATIC);
}

async function getAchievementMedia(id, token) {
  const path = `/data/wow/media/achievement/${id}`;
  return apiFetch(path, token, NAMESPACE_STATIC);
}

// ---------- Discord ----------
async function postToDiscord(achievementPayload) {
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(achievementPayload)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to post to Discord: ${res.status} ${text}`);
  }
}

// ---------- Main logic ----------
async function run() {
  try {
    const token = await getAccessToken();
    const guildAchievements = await getGuildAchievements(token);

    // You might want to filter here (e.g., only new achievements since last run)
    for (const entry of guildAchievements) {
      const achievementId = entry.achievement.id;

      // Fetch details + media in parallel
      const [details, media] = await Promise.all([
        getAchievementDetails(achievementId, token),
        getAchievementMedia(achievementId, token)
      ]);

      const description = details.description || '';
      const name = details.name || `Achievement #${achievementId}`;

      // media.assets is usually an array; find the icon asset
      let iconUrl = null;
      if (media && Array.isArray(media.assets)) {
        const iconAsset =
          media.assets.find(a => a.key === 'icon') || media.assets[0];
        if (iconAsset) iconUrl = iconAsset.value;
      }

      // Build Discord embed
      const embed = {
        title: name,
        description: description,
        thumbnail: iconUrl ? { url: iconUrl } : undefined,
        timestamp: new Date(entry.completed_timestamp).toISOString(),
        footer: {
          text: `Achievement ID: ${achievementId}`
        }
      };

      const payload = {
        content: `Guild achievement earned!`,
        embeds: [embed]
      };

      await postToDiscord(payload);
    }
  } catch (err) {
    console.error('Fatal error:', err);
  }
}

run();
