// Rules shared by Squad chat that do not need a live terminal.
// A model id is passed through only when this build has a verified env var for that CLI.
// A Claude lead is told to delegate multi-file jobs through the agent kit.
const { model_env } = require('./cli_capabilities');

function model_launch_id(agent_id, model_id) {
  if (typeof model_id !== 'string' || model_id.trim() === '') return null;
  const env = model_env(agent_id, model_id);
  return Object.keys(env).length > 0 ? model_id.trim() : null;
}

function looks_like_lead(bot) {
  const handle = String((bot && bot.handle) || '').trim().toLowerCase();
  const role = String((bot && bot.role) || '').toLowerCase();
  return handle === 'lead' || handle === 'arch' || /\b(lead|chief|architect)\b/.test(role);
}

// Empty when the bot is not a Claude lead, or when its saved prompt already names the skill.
function delegation_note(bot) {
  if (!bot || bot.agent_id !== 'claude' || !looks_like_lead(bot)) return '';
  if (String(bot.system_prompt || '').includes('/agentsense:lead')) return '';
  return 'When a job touches several files, start it with /agentsense:lead. That skill plans the work, runs workers in their own git worktrees, and does not merge until the user approves. Do not merge or push from this chat.';
}

module.exports = {
  model_launch_id,
  looks_like_lead,
  delegation_note,
};
