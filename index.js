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
  const client = new MongoClient(config.mongoUri);
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
 
const RANKS = [
  { keywords: ["mythical immortal", "immortal"], role: "Mythical Immortal", color: 0xFF0000, order: 10 },
  { keywords: ["mythical glory", "glory"],        role: "Mythical Glory",    color: 0xFFD700, order: 9  },
  { keywords: ["mythical honor", "honor"],        role: "Mythical Honor",    color: 0xFFA500, order: 8  },
  { keywords: ["mythic"],                         role: "Mythic",            color: 0x9B59B6, order: 7  },
  { keywords: ["legend"],                         role: "Legend",            color: 0x3498DB, order: 6  },
  { keywords: ["epic"],                           role: "Epic",              color: 0x8E44AD, order: 5  },
  { keywords: ["grandmaster"],                    role: "Grandmaster",       color: 0xE67E22, order: 4  },
  { keywords: ["master"],                         role: "Master",            color: 0x2ECC71, order: 3  },
  { keywords: ["elite"],                          role: "Elite",             color: 0x1ABC9C, order: 2  },
  { keywords: ["warrior"],                        role: "Warrior",           color: 0x95A5A6, order: 1  },
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
  let ingameId = null, serverId = null, role = null, rank = null;
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
  return lower.includes("ingame id:") && lower.includes("server id:") &&
         lower.includes("role:") && lower.includes("rank:");
}
 
function allFieldsFilled({ ingameId, serverId, role, rank }) {
  return ingameId?.length > 0 && serverId?.length > 0 &&
         role?.length > 0 && rank?.length > 0;
}
 
function isNumeric(value) { return /^\d+$/.test(value.trim()); }
function isLettersOnly(value) { return /^[a-zA-Z\s]+$/.test(value.trim()); }
 
function matchRank(value) {
  if (!value) return null;
  const lower = value.toLowerCase();
  for (const entry of RANKS) {
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
 
async function getOrCreateRole(guild, roleName, color = null) {
  let role = guild.roles.cache.find((r) => r.name === roleName);
  if (!role) {
    role = await guild.roles.create({
      name: roleName,
      color: color || 0x99AAB5,
      reason: "MLBB Role Bot",
    });
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
 
async function sendTempWarning(channel, user, text) {
  const warning = await channel.send(`${user}\n${text}`);
  setTimeout(() => warning.delete().catch(() => {}), 8000);
}
 
function isAdmin(member) {
  return member.permissions.has("Administrator") ||
         member.roles.cache.some((r) => r.name === config.adminRoleName);
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
 
  // ── ADMIN COMMANDS (work in any channel) ──
  if (content.startsWith("!")) {
    await handleCommand(message, member, guild, channel, user, content);
    return;
  }
 
  // ── REGISTRATION CHANNEL ONLY ──
  if (channel.name !== config.listenChannelName) return;
 
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
 
  // ── STEP 3: Ingame ID and Server ID must be numbers ──
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
 
  // ── STEP 4: Role and Rank must be letters ──
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
 
  // ── STEP 5: Match rank and role ──
  const detectedRankEntry = matchRank(rank);
  const detectedLaneEntry = matchLane(role);
  const errors = [];
 
  if (!detectedRankEntry) errors.push(`❌ Unknown rank: \`${rank}\`\n**Valid Ranks:** Warrior · Elite · Master · Grandmaster · Epic · Legend · Mythic · Mythical Honor · Mythical Glory · Mythical Immortal`);
  if (!detectedLaneEntry) errors.push(`❌ Unknown role: \`${role}\`\n**Valid Roles:** EXP · Gold · Jungler · Mid · Roam`);
 
  if (errors.length > 0) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `❌ Your message was removed:\n${errors.join("\n\n")}\n\nPlease fix and repost.\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 6: Check if already registered ──
  const existing = await getPlayer(message.author.id);
  if (existing) {
    await message.delete().catch(() => {});
    await sendTempWarning(channel, user,
      `⚠️ You are already registered as **${existing.rank}** / **${existing.lane}**.\nContact an admin if you need to update your info.\n*This message will disappear in 8 seconds.*`
    );
    return;
  }
 
  // ── STEP 7: Assign roles ──
  try {
    await removeOldRoles(member, RANKS);
    const rankRole = await getOrCreateRole(guild, detectedRankEntry.role, detectedRankEntry.color);
    await member.roles.add(rankRole);
 
    await removeOldRoles(member, LANE_ROLES);
    const laneRole = await getOrCreateRole(guild, detectedLaneEntry.role);
    await member.roles.add(laneRole);
 
    // ── STEP 8: Save to MongoDB ──
    await savePlayer({
      discordId:   message.author.id,
      discordTag:  message.author.tag,
      displayName: member.displayName,
      ingameId,
      serverId,
      rank:        detectedRankEntry.role,
      rankOrder:   detectedRankEntry.order,
      lane:        detectedLaneEntry.role,
      registeredAt: new Date(),
    });
 
    // ── STEP 9: Reply with embed ──
    const embed = new EmbedBuilder()
      .setColor(detectedRankEntry.color)
      .setTitle("✅ Registration Successful!")
      .setDescription(`Welcome, **${member.displayName}**! Your roles have been assigned.`)
      .addFields(
        { name: "🎮 Ingame ID", value: `\`${ingameId}\``, inline: true },
        { name: "🌐 Server ID", value: `\`${serverId}\``, inline: true },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "🏆 Rank",     value: detectedRankEntry.role, inline: true },
        { name: "🗺️ Role",     value: detectedLaneEntry.role, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: "MLBB Role Bot" });
 
    await message.reply({ embeds: [embed] });
 
    // ── STEP 10: Log to bot-logs ──
    const logChannel = guild.channels.cache.find((c) => c.name === config.logChannelName);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle("📋 New Registration")
        .addFields(
          { name: "Discord",    value: `<@${message.author.id}> (${message.author.tag})`, inline: false },
          { name: "🎮 Ingame ID", value: `\`${ingameId}\``, inline: true },
          { name: "🌐 Server ID", value: `\`${serverId}\``, inline: true },
          { name: "🏆 Rank",     value: detectedRankEntry.role, inline: true },
          { name: "🗺️ Role",     value: detectedLaneEntry.role, inline: true },
        )
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }
 
  } catch (err) {
    console.error("Error:", err);
    await message.reply("⚠️ Something went wrong. Make sure I have **Manage Roles** permission!");
  }
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
 
    await removeOldRoles(target, RANKS);
    await removeOldRoles(target, LANE_ROLES);
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
 
    const embed = new EmbedBuilder()
      .setColor(0x3498DB)
      .setTitle(`🔍 Player Info — ${player.displayName}`)
      .addFields(
        { name: "🎮 Ingame ID", value: `\`${player.ingameId}\``, inline: true },
        { name: "🌐 Server ID", value: `\`${player.serverId}\``, inline: true },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "🏆 Rank",     value: player.rank, inline: true },
        { name: "🗺️ Role",     value: player.lane, inline: true },
        { name: "📅 Registered", value: new Date(player.registeredAt).toDateString(), inline: true },
      )
      .setTimestamp();
 
    return message.reply({ embeds: [embed] });
  }
 
  // ── !stats ──
  if (command === "stats") {
    if (!isAdmin(member)) return message.reply("❌ You don't have permission to use this command.");
 
    const players = await getAllPlayers();
    const total   = players.length;
 
    const rankCounts = {};
    const laneCounts = {};
 
    for (const p of players) {
      rankCounts[p.rank] = (rankCounts[p.rank] || 0) + 1;
      laneCounts[p.lane] = (laneCounts[p.lane] || 0) + 1;
    }
 
    const rankStats = RANKS
      .filter((r) => rankCounts[r.role])
      .map((r) => `${r.role}: **${rankCounts[r.role]}**`)
      .join("\n") || "No data";
 
    const laneStats = LANE_ROLES
      .filter((r) => laneCounts[r.role])
      .map((r) => `${r.role}: **${laneCounts[r.role]}**`)
      .join("\n") || "No data";
 
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("📊 Server Stats")
      .addFields(
        { name: "👥 Total Registered", value: `**${total}** players`, inline: false },
        { name: "🏆 By Rank", value: rankStats, inline: true },
        { name: "🗺️ By Role", value: laneStats, inline: true },
      )
      .setTimestamp();
 
    return message.reply({ embeds: [embed] });
  }
 
  // ── !leaderboard ──
  if (command === "leaderboard" || command === "lb") {
    const players = await getAllPlayers();
    if (players.length === 0) return message.reply("❌ No players registered yet.");
 
    const sorted = players
      .sort((a, b) => b.rankOrder - a.rankOrder)
      .slice(0, 10);
 
    const medals = ["🥇", "🥈", "🥉"];
    const list = sorted
      .map((p, i) => {
        const medal = medals[i] || `**${i + 1}.**`;
        return `${medal} <@${p.discordId}> — ${p.rank} / ${p.lane}`;
      })
      .join("\n");
 
    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle("🏆 MLBB Leaderboard — Top 10")
      .setDescription(list)
      .setTimestamp()
      .setFooter({ text: "Ranked by highest rank" });
 
    return message.reply({ embeds: [embed] });
  }
}
 
// ─── START ─────────────────────────────────────────────────────────────────────
 
connectDB().then(() => {
  client.login(config.token);
}).catch((err) => {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
});
