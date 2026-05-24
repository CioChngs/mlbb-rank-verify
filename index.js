const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const { MongoClient } = require("mongodb");
 
// ─── CONFIG ────────────────────────────────────────────────────────────────────
 
const config = {
  token: process.env.BOT_TOKEN,
  mongoUri: process.env.MONGO_URI,
  listenChannelName: process.env.CHANNEL_NAME || "mlbb-rank-verify",
  logChannelName: process.env.LOG_CHANNEL_NAME || "bot-logs",
  adminRoleName: process.env.ADMIN_ROLE_NAME || "Admin",
};
 
// ─── MONGODB ───────────────────────────────────────────────────────────────────
 
let db;
async function connectDB() {
  const client = new MongoClient(config.mongoUri, {
    tls: true,
    tlsAllowInvalidCertificates: true,
  });
  await client.connect();
  db = client.db("mlbb_bot");
  console.log("✅ Connected to MongoDB");
}
 
async function getPlayer(discordId) {
  return db.collection("players").findOne({ discordId });
}
 
async function savePlayer(data) {
  await db.collection("players").updateOne(
    { discordId: data.discordId },
    { $set: data },
    { upsert: true }
  );
}
 
async function deletePlayer(discordId) {
  await db.collection("players").deleteOne({ discordId });
}
 
async function getAllPlayers() {
  return db.collection("players").find().toArray();
}
 
// ─── DISCORD CLIENT ────────────────────────────────────────────────────────────
 
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
 
const MYTHIC_TIERS = [
  { min: 100, max: Infinity, role: "Mythical Immortal", color: 0xFF0000, order: 10 },
  { min: 50,  max: 99,       role: "Mythical Glory",    color: 0xFFD700, order: 9  },
  { min: 25,  max: 49,       role: "Mythical Honor",    color: 0xFFA500, order: 8  },
  { min: 0,   max: 24,       role: "Mythic",            color: 0x9B59B6, order: 7  },
];
 
const NORMAL_RANKS = [
  { keywords: ["legend"],      role: "Legend",      color: 0x3498DB, order: 6 },
  { keywords: ["epic"],        role: "Epic",         color: 0x8E44AD, order: 5 },
  { keywords: ["grandmaster"], role: "Grandmaster",  color: 0xE67E22, order: 4 },
  { keywords: ["master"],      role: "Master",       color: 0x2ECC71, order: 3 },
  { keywords: ["elite"],       role: "Elite",        color: 0x1ABC9C, order: 2 },
  { keywords: ["warrior"],     role: "Warrior",      color: 0x95A5A6, order: 1 },
];
 
const ALL_RANK_ROLES = [
  "Mythical Immortal", "Mythical Glory", "Mythical Honor", "Mythic",
  "Legend", "Epic", "Grandmaster", "Master", "Elite", "Warrior",
];
 
const LANE_ROLES = [
  { keywords: ["exp laner", "exp lane", "exp"],    role: "EXP Laner"  },
  { keywords: ["gold laner", "gold lane", "gold"], role: "Gold Laner" },
  { keywords: ["jungler", "jungle", "jgl"],        role: "Jungler"    },
  { keywords: ["mid laner", "mid lane", "mid"],    role: "Mid Laner"  },
  { keywords: ["roamer", "roam", "support"],       role: "Roamer"     },
];
 
// ─── HELPERS ───────────────────────────────────────────────────────────────────
 
function parseForm(content) {
  const lines = content.split("\n").map((l) => l.trim());
  let ingameId = null, serverId = null, role = null, rank = null, stars = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("ingame id:"))      ingameId = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("server id:")) serverId = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("role:"))      role     = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("rank:"))      rank     = line.split(":").slice(1).join(":").trim();
    else if (lower.startsWith("stars:"))     stars    = line.split(":").slice(1).join(":").trim().replace(/[^0-9]/g, "");
  }
  return { ingameId, serverId, role, rank, stars };
}
 
function isMythicKeyword(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.includes("mythic") || lower.includes("immortal") ||
         lower.includes("glory")  || lower.includes("honor");
}
 
function getRankFromStars(stars) {
  const num = parseInt(stars);
  return MYTHIC_TIERS.find((t) => num >= t.min && num <= t.max) || null;
}
 
function matchNormalRank(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const entry of NORMAL_RANKS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry;
  }
  return null;
}
 
function matchLane(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const entry of LANE_ROLES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry;
  }
  return null;
}
 
function isNumeric(value) { return /^\d+$/.test(value?.trim()); }
function isLettersOnly(value) { return /^[a-zA-Z\s]+$/.test(value?.trim()); }
function isAdmin(member) {
  return member.permissions.has("Administrator") ||
         member.roles.cache.some((r) => r.name === config.adminRoleName);
}
 
async function getOrCreateRole(guild, roleName, color = 0x99AAB5) {
  let role = guild.roles.cache.find((r) => r.name === roleName);
  if (!role) {
    role = await guild.roles.create({ name: roleName, color, reason: "MLBB Role Bot" });
    console.log(`Created role: ${roleName}`);
  }
  return role;
}
 
async function removeOldRankRoles(member) {
  for (const roleName of ALL_RANK_ROLES) {
    const role = member.roles.cache.find((r) => r.name === roleName);
    if (role) await member.roles.remove(role);
  }
}
 
async function removeOldLaneRoles(member) {
  for (const entry of LANE_ROLES) {
    const role = member.roles.cache.find((r) => r.name === entry.role);
    if (role) await member.roles.remove(role);
  }
}
 
async function sendTempWarning(channel, user, text) {
  const warning = await channel.send(`${user}\n${text}`);
  setTimeout(() => warning.delete().catch(() => {}), 8000);
}
 
// ─── LEADERBOARD SORT ──────────────────────────────────────────────────────────
// Sort by rankOrder DESC, then by stars DESC (for same rank tier)
function sortPlayers(players) {
  return players.sort((a, b) => {
    if (b.rankOrder !== a.rankOrder) return b.rankOrder - a.rankOrder;
    const starsA = a.stars ?? -1;
    const starsB = b.stars ?? -1;
    return starsB - starsA;
  });
}
 
// ─── READY ─────────────────────────────────────────────────────────────────────
 
client.once("clientReady", () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`📡 Watching: #${config.listenChannelName}`);
});
 
// ─── MESSAGE ───────────────────────────────────────────────────────────────────
 
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
 
  const channel = message.channel;
  const member  = message.member;
  const guild   = message.guild;
  const user    = `<@${message.author.id}>`;
  const content = message.content.trim();
 
  // ── ADMIN COMMANDS ──
  if (content.startsWith("!")) {
    await handleCommand(message, member, guild, channel, user, content);
    return;
  }
 
  // ── REGISTRATION CHANNEL ONLY ──
  if (channel.name !== config.listenChannelName) return;
 
  const { rank: rawRank } = parseForm(content);
  const mythic = isMythicKeyword(rawRank);
 
  // ── STEP 1: Must have all required fields ──
  const lower = content.toLowerCase();
  const hasBase = lower.includes("ingame id:") && lower.includes("server id:") &&
                  lower.includes("role:") && lower.includes("rank:");
  const hasStars = lower.includes("stars:");
 
  if (!hasBase || (mythic && !hasStars)) {
    await message.delete().catch(() => {});
    const format = mythic
      ? `\`\`\`\nIngame ID:\nServer ID:\nRole:\nRank:\nStars:\n\`\`\``
      : `\`\`\`\nIngame ID:\nServer ID:\nRole:\nRank:\n\`\`\``;
    await sendTempWarning(channel, user,
      `❌ Your message was removed. Please use the correct format:\n${format}\n> ⚠️ **Stars** is required for Mythic rank and above!\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  const { ingameId, serverId, role, rank, stars } = parseForm(content);
 
  // ── STEP 2: All fields must be filled ──
  const baseFilled = ingameId?.length > 0 && serverId?.length > 0 &&
                     role?.length > 0 && rank?.length > 0;
  if (!baseFilled || (mythic && !stars?.length)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed. All fields must be filled in.\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 3: Ingame ID and Server ID must be numbers ──
  if (!isNumeric(ingameId)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ **Ingame ID** must be numbers only (e.g. \`12345678\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  if (!isNumeric(serverId)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ **Server ID** must be numbers only (e.g. \`1234\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 4: Role and Rank must be letters ──
  if (!isLettersOnly(role)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ **Role** must be letters only (e.g. \`EXP\`, \`Gold\`, \`Jungler\`, \`Mid\`, \`Roam\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  if (!isLettersOnly(rank)) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ **Rank** must be letters only (e.g. \`Mythic\`, \`Epic\`, \`Legend\`).\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 5: Determine final rank entry ──
  let detectedRankEntry = null;
 
  if (mythic) {
    detectedRankEntry = getRankFromStars(stars);
    if (!detectedRankEntry) {
      await message.delete().catch(() => {});
      await sendTempWarning(channel, user,
        `❌ Could not determine rank from stars \`${stars}\`. Please enter a valid number.\n*This message will disappear in 8 seconds.*`
      );
      return;
    }
  } else {
    detectedRankEntry = matchNormalRank(rank);
    if (!detectedRankEntry) {
      await message.delete().catch(() => {});
      await sendTempWarning(channel, user,
        `❌ Unknown rank: \`${rank}\`\n**Valid Ranks:** Warrior · Elite · Master · Grandmaster · Epic · Legend · Mythic · Mythical Honor · Mythical Glory · Mythical Immortal\n*This message will disappear in 8 seconds.*`
      );
      return;
    }
  }
 
  // ── STEP 6: Detect lane ──
  const detectedLaneEntry = matchLane(role);
  if (!detectedLaneEntry) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Unknown role: \`${role}\`\n**Valid Roles:** EXP · Gold · Jungler · Mid · Roam\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 7: Check if already registered ──
  const existing = await getPlayer(message.author.id);
  if (existing) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `⚠️ You are already registered as **${existing.rank}** ${existing.stars != null ? `(${existing.stars} ⭐)` : ""} / **${existing.lane}**.\nContact an admin if you need to update your info.\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 8: Assign roles ──
  try {
    await removeOldRankRoles(member);
    const rankRole = await getOrCreateRole(guild, detectedRankEntry.role, detectedRankEntry.color);
    await member.roles.add(rankRole);
 
    await removeOldLaneRoles(member);
    const laneRole = await getOrCreateRole(guild, detectedLaneEntry.role);
    await member.roles.add(laneRole);
 
    const starsNum = stars ? parseInt(stars) : null;
 
    // ── STEP 9: Save to MongoDB ──
    await savePlayer({
      discordId:    message.author.id,
      discordTag:   message.author.tag,
      displayName:  member.displayName,
      ingameId,
      serverId,
      rank:         detectedRankEntry.role,
      rankOrder:    detectedRankEntry.order,
      stars:        starsNum,
      lane:         detectedLaneEntry.role,
      registeredAt: new Date(),
    });
 
    // ── STEP 10: Reply embed ──
    const fields = [
      { name: "🎮 Ingame ID", value: `\`${ingameId}\``, inline: true },
      { name: "🌐 Server ID", value: `\`${serverId}\``, inline: true },
      { name: "\u200B",       value: "\u200B",           inline: true },
      { name: "🏆 Rank",      value: detectedRankEntry.role, inline: true },
      { name: "🗺️ Role",      value: detectedLaneEntry.role, inline: true },
    ];
    if (starsNum !== null) fields.push({ name: "⭐ Stars", value: `\`${starsNum}\``, inline: true });
 
    const embed = new EmbedBuilder()
      .setColor(detectedRankEntry.color)
      .setTitle("✅ Registration Successful!")
      .setDescription(`Welcome, **${member.displayName}**! Your roles have been assigned.`)
      .addFields(fields)
      .setTimestamp()
      .setFooter({ text: "MLBB Role Bot" });
 
    await channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
 
    // ── STEP 11: Log ──
    try {
      const logChannel = guild.channels.cache.find((c) => c.name === config.logChannelName);
    if (logChannel) {
      const logFields = [
        { name: "Discord",      value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
        { name: "🎮 Ingame ID", value: `\`${ingameId}\``, inline: true },
        { name: "🌐 Server ID", value: `\`${serverId}\``, inline: true },
        { name: "🏆 Rank",      value: detectedRankEntry.role, inline: true },
        { name: "🗺️ Role",      value: detectedLaneEntry.role, inline: true },
      ];
      if (starsNum !== null) logFields.push({ name: "⭐ Stars", value: `\`${starsNum}\``, inline: true });
 
      await logChannel.send({ embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle("📋 New Registration")
          .addFields(logFields)
          .setTimestamp()
      ]});
      }
    } catch (logErr) {
      console.error("Log channel error:", logErr.message);
    }
 
  } catch (err) {
    console.error("Error:", err.message);
    channel.send(`<@${message.author.id}> ⚠️ Something went wrong. Make sure I have **Manage Roles** permission!`).catch(() => {});
  }
});
 
// ─── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err.message);
});
 
// ─── ADMIN COMMANDS ────────────────────────────────────────────────────────────
 
async function handleCommand(message, member, guild, channel, user, content) {
  const args    = content.slice(1).trim().split(/\s+/);
  const command = args[0].toLowerCase();
 
  // ── !resetroles @user ──
  if (command === "resetroles") {
    if (!isAdmin(member)) return message.reply("❌ You don't have permission to use this command.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Please mention a user. Example: `!resetroles @user`");
 
    await removeOldRankRoles(target);
    await removeOldLaneRoles(target);
    await deletePlayer(target.id);
 
    return message.reply(`✅ Removed all MLBB roles from **${target.displayName}**. They can now re-register.`);
  }
 
  // ── !whois @user ──
  if (command === "whois") {
    if (!isAdmin(member)) return message.reply("❌ You don't have permission to use this command.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Please mention a user. Example: `!whois @user`");
 
    const player = await getPlayer(target.id);
    if (!player) return message.reply(`❌ **${target.displayName}** is not registered.`);
 
    const fields = [
      { name: "🎮 Ingame ID", value: `\`${player.ingameId}\``, inline: true },
      { name: "🌐 Server ID", value: `\`${player.serverId}\``, inline: true },
      { name: "\u200B",       value: "\u200B",                  inline: true },
      { name: "🏆 Rank",      value: player.rank,               inline: true },
      { name: "🗺️ Role",      value: player.lane,               inline: true },
    ];
    if (player.stars !== null && player.stars !== undefined) {
      fields.push({ name: "⭐ Stars", value: `\`${player.stars}\``, inline: true });
    }
    fields.push({ name: "📅 Registered", value: new Date(player.registeredAt).toDateString(), inline: false });
 
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`🔍 Player Info — ${player.displayName}`)
        .addFields(fields)
        .setTimestamp()
    ]});
  }
 
  // ── !stats ──
  if (command === "stats") {
    if (!isAdmin(member)) return message.reply("❌ You don't have permission to use this command.");
 
    const players = await getAllPlayers();
    const rankCounts = {};
    const laneCounts = {};
 
    for (const p of players) {
      rankCounts[p.rank] = (rankCounts[p.rank] || 0) + 1;
      laneCounts[p.lane] = (laneCounts[p.lane] || 0) + 1;
    }
 
    const rankStats = [...MYTHIC_TIERS, ...NORMAL_RANKS]
      .filter((r) => rankCounts[r.role])
      .map((r) => `${r.role}: **${rankCounts[r.role]}**`)
      .join("\n") || "No data";
 
    const laneStats = LANE_ROLES
      .filter((r) => laneCounts[r.role])
      .map((r) => `${r.role}: **${laneCounts[r.role]}**`)
      .join("\n") || "No data";
 
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle("📊 Server Stats")
        .addFields(
          { name: "👥 Total Registered", value: `**${players.length}** players`, inline: false },
          { name: "🏆 By Rank",          value: rankStats, inline: true },
          { name: "🗺️ By Role",          value: laneStats, inline: true },
        )
        .setTimestamp()
    ]});
  }
 
  // ── !leaderboard / !lb ──
  if (command === "leaderboard" || command === "lb") {
    const players = await getAllPlayers();
    if (players.length === 0) return message.reply("❌ No players registered yet.");
 
    const sorted = sortPlayers(players).slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
 
    const list = sorted.map((p, i) => {
      const medal  = medals[i] || `**${i + 1}.**`;
      const stars  = p.stars !== null && p.stars !== undefined ? ` · ⭐ ${p.stars}` : "";
      return `${medal} <@${p.discordId}> — ${p.rank}${stars} / ${p.lane}`;
    }).join("\n");
 
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle("🏆 MLBB Leaderboard — Top 10")
        .setDescription(list)
        .setTimestamp()
        .setFooter({ text: "Sorted by rank · then by stars" })
    ]});
  }
}
 
// ─── START ─────────────────────────────────────────────────────────────────────
 
connectDB().then(() => {
  client.login(config.token);
}).catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
