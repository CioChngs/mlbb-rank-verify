const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── RANK & ROLE MAPS ──────────────────────────────────────────────────────────

const RANKS = [
  { keywords: ["mythical immortal", "immortal"],  role: "Mythical Immortal" },
  { keywords: ["mythical glory", "glory"],         role: "Mythical Glory" },
  { keywords: ["mythical honor", "honor"],         role: "Mythical Honor" },
  { keywords: ["mythic"],                          role: "Mythic" },
  { keywords: ["legend"],                          role: "Legend" },
  { keywords: ["epic"],                            role: "Epic" },
  { keywords: ["grandmaster"],                     role: "Grandmaster" },
  { keywords: ["master"],                          role: "Master" },
  { keywords: ["elite"],                           role: "Elite" },
  { keywords: ["warrior"],                         role: "Warrior" },
];

const LANE_ROLES = [
  { keywords: ["exp laner", "exp lane", "exp"],    role: "EXP Laner" },
  { keywords: ["gold laner", "gold lane", "gold"], role: "Gold Laner" },
  { keywords: ["jungler", "jungle", "jgl"],        role: "Jungler" },
  { keywords: ["mid laner", "mid lane", "mid"],    role: "Mid Laner" },
  { keywords: ["roamer", "roam", "support"],       role: "Roamer" },
];

// ─── PARSE THE FORM ────────────────────────────────────────────────────────────

function parseForm(content) {
  const lines = content.split("\n").map((l) => l.trim());

  let ingameId = null;
  let serverId = null;
  let role     = null;
  let rank     = null;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("ingame id:"))      ingameId = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("server id:")) serverId = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("role:"))      role     = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("rank:"))      rank     = line.split(":").slice(1).join(":").trim();
  }

  return { ingameId, serverId, role, rank };
}

function hasAllFields(content) {
  const lower = content.toLowerCase();
  return (
    lower.includes("ingame id:") &&
    lower.includes("server id:") &&
    lower.includes("role:")      &&
    lower.includes("rank:")
  );
}

function allFieldsFilled({ ingameId, serverId, role, rank }) {
  return (
    ingameId && ingameId.length > 0 &&
    serverId && serverId.length > 0 &&
    role     && role.length > 0     &&
    rank     && rank.length > 0
  );
}

// ─── VALIDATE FIELD TYPES ──────────────────────────────────────────────────────

function isNumeric(value) {
  return /^\d+$/.test(value.trim());
}

function isLettersOnly(value) {
  return /^[a-zA-Z\s]+$/.test(value.trim());
}

// ─── DETECT RANK / LANE ────────────────────────────────────────────────────────

function matchRank(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const entry of RANKS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.role;
  }
  return null;
}

function matchLane(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const entry of LANE_ROLES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.role;
  }
  return null;
}

// ─── ROLE HELPERS ──────────────────────────────────────────────────────────────

async function getOrCreateRole(guild, roleName) {
  let role = guild.roles.cache.find((r) => r.name === roleName);
  if (!role) {
    role = await guild.roles.create({ name: roleName, reason: "MLBB Role Bot" });
    console.log(`Created role: ${roleName}`);
  }
  return role;
}

async function removeOldRoles(member, categoryList) {
  for (const entry of categoryList) {
    const role = member.roles.cache.find((r) => r.name === entry.role);
    if (role) await member.roles.remove(role);
  }
}

async function assignRole(member, guild, roleName) {
  const role = await getOrCreateRole(guild, roleName);
  if (!member.roles.cache.has(role.id)) await member.roles.add(role);
}

// ─── TEMP WARNING (auto-deletes after 8 seconds) ──────────────────────────────

async function sendTempWarning(channel, user, text) {
  const warning = await channel.send(`${user}\n${text}`);
  setTimeout(() => warning.delete().catch(() => {}), 8000);
}

// ─── READY ─────────────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`📡 Watching: #${config.listenChannelName}`);
});

// ─── MESSAGE ───────────────────────────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.channel.name !== config.listenChannelName) return;

  const content = message.content;
  const member  = message.member;
  const guild   = message.guild;
  const channel = message.channel;
  const user    = `<@${message.author.id}>`;

  // ── STEP 1: Must have all 4 field labels ──
  if (!hasAllFields(content)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. Please use the correct format:\n\`\`\`\nIngame ID:\nServer ID:\nRole:\nRank:\n\`\`\`\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  const { ingameId, serverId, role, rank } = parseForm(content);

  // ── STEP 2: All fields must be filled ──
  if (!allFieldsFilled({ ingameId, serverId, role, rank })) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. All fields must be filled in.\n\`\`\`\nIngame ID: 12345678\nServer ID: 1234\nRole: EXP\nRank: Mythical Glory\n\`\`\`\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  // ── STEP 3: Ingame ID and Server ID must be numbers only ──
  if (!isNumeric(ingameId)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. **Ingame ID** must be numbers only (e.g. \`12345678\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  if (!isNumeric(serverId)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. **Server ID** must be numbers only (e.g. \`1234\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  // ── STEP 4: Role and Rank must be letters only ──
  if (!isLettersOnly(role)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. **Role** must be letters only (e.g. \`EXP\`, \`Gold\`, \`Jungler\`, \`Mid\`, \`Roam\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  if (!isLettersOnly(rank)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. **Rank** must be letters only (e.g. \`Mythical Glory\`, \`Epic\`, \`Legend\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  // ── STEP 5: Match against known ranks and roles ──
  const detectedRank = matchRank(rank);
  const detectedLane = matchLane(role);
  const errors = [];

  if (!detectedRank) errors.push(`❌ Unknown rank: \`${rank}\`\n**Valid Ranks:** Warrior · Elite · Master · Grandmaster · Epic · Legend · Mythic · Mythical Honor · Mythical Glory · Mythical Immortal`);
  if (!detectedLane) errors.push(`❌ Unknown role: \`${role}\`\n**Valid Roles:** EXP · Gold · Jungler · Mid · Roam`);

  if (errors.length > 0) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed:\n${errors.join("\n\n")}\n\nPlease fix and repost.\n*This message will disappear in 8 seconds.*`
    );
    return;
  }

  // ── STEP 6: All good — assign roles ──
  try {
    await removeOldRoles(member, RANKS);
    await assignRole(member, guild, detectedRank);

    await removeOldRoles(member, LANE_ROLES);
    await assignRole(member, guild, detectedLane);

    await message.reply(
      `✅ Registered, **${member.displayName}**!\n\n` +
      `🎮 Ingame ID: \`${ingameId}\`\n` +
      `🌐 Server ID: \`${serverId}\`\n` +
      `📌 Roles assigned: **${detectedRank}** + **${detectedLane}**`
    );

  } catch (err) {
    console.error("Error:", err);
    await message.reply("⚠️ Something went wrong. Make sure I have **Manage Roles** permission and my role is above all MLBB roles!");
  }
});

// ─── LOGIN ─────────────────────────────────────────────────────────────────────

client.login(process.env.BOT_TOKEN || config.token);