// What each catalogued CLI is known to accept. Flags that are not verified against that CLI's
// own help or docs are not invented here. Shared by the desktop launch path and the phone.
// resume:
//   conversation — official session resume, verified for this adapter
//   terminal     — only the shell/command is started again; this is not a continued chat
//   unverified   — a resume mechanism may exist, but this build does not claim it
const CAPABILITIES = {
  claude: {
    command: 'claude',
    resume: 'conversation',
    resume_note: 'claude --resume <session-id> (Claude Code). A missing id is reported; a new chat is not started in its place.',
    model_env: 'ANTHROPIC_MODEL',
    provider_kinds: ['anthropic'],
  },
  codex: {
    command: 'codex',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified for this CLI version. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  gemini: {
    command: 'gemini',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  copilot: {
    command: 'copilot',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  pi: {
    command: 'pi',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  hermes: {
    command: 'hermes',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  cursor: {
    command: 'cursor-agent',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  droid: {
    command: 'droid',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  opencode: {
    command: 'opencode',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  deepseek: {
    command: 'dsh',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  grok: {
    command: 'grok',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  kimi: {
    command: 'kimi',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  antigravity: {
    command: 'agy',
    resume: 'unverified',
    resume_note: 'Resume flags were not verified. Restart restores the terminal only.',
    model_env: null,
    provider_kinds: [],
  },
  terminal: {
    command: 'powershell.exe',
    resume: 'terminal',
    resume_note: 'A shell has no agent conversation to resume.',
    model_env: null,
    provider_kinds: [],
  },
  custom: {
    command: null,
    resume: 'terminal',
    resume_note: 'A custom command is started again. That is not a continued agent conversation.',
    model_env: null,
    provider_kinds: [],
  },
};

function capability_for(agent_id) {
  const id = typeof agent_id === 'string' ? agent_id.trim().toLowerCase() : '';
  return CAPABILITIES[id] || CAPABILITIES.custom;
}

// Throws when the chosen provider kind is not supported by this agent. A missing provider id is fine.
function assert_provider_compatible(agent_id, provider_kind) {
  if (!provider_kind) return;
  const caps = capability_for(agent_id);
  if (!caps.provider_kinds.includes(provider_kind)) {
    throw new Error(`${agent_id} does not accept a ${provider_kind} provider in this build`);
  }
}

// Env added for a verified model. Unknown CLIs get nothing: no <AGENT>_MODEL and no OPENAI_* guess.
function model_env(agent_id, model_id) {
  if (typeof model_id !== 'string' || model_id.trim() === '') return {};
  const caps = capability_for(agent_id);
  if (!caps.model_env) return {};
  return { [caps.model_env]: model_id.trim() };
}

function resume_mode(agent_id) {
  return capability_for(agent_id).resume;
}

module.exports = {
  CAPABILITIES,
  capability_for,
  assert_provider_compatible,
  model_env,
  resume_mode,
};
