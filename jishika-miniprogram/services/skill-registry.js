const SKILLS = {
  create_card_from_chat: {
    name: 'create_card_from_chat',
    title: '从聊天整理记事卡',
    page: '/pages/card-edit/card-edit',
    defaultType: 'requirement',
    action: 'create_from_chat'
  },
  create_requirement_card: {
    name: 'create_requirement_card',
    title: '生成需求确认卡',
    page: '/pages/card-edit/card-edit',
    defaultType: 'requirement',
    action: 'generate_draft'
  },
  create_progress_card: {
    name: 'create_progress_card',
    title: '生成服务进度卡',
    page: '/pages/card-edit/card-edit',
    defaultType: 'progress',
    action: 'generate_draft'
  },
  create_group_todo: {
    name: 'create_group_todo',
    title: '整理群聊待办',
    page: '/pages/card-edit/card-edit',
    defaultType: 'todo',
    action: 'generate_draft'
  },
  create_meeting_record: {
    name: 'create_meeting_record',
    title: '生成预约记录',
    page: '/pages/card-edit/card-edit',
    defaultType: 'meeting',
    action: 'generate_draft'
  },
  open_mutual_help: {
    name: 'open_mutual_help',
    title: '打开互助页',
    page: '/pages/mutual-help/mutual-help',
    defaultType: '',
    action: 'open_mutual_help'
  }
};

function getSkill(name) {
  return SKILLS[name] || null;
}

function listSkills() {
  return Object.keys(SKILLS).map((name) => SKILLS[name]);
}

function inferSkillName(text = '', intent = '') {
  const value = `${intent} ${text}`;

  if (/互助|朋友|协作圈|服务入口/.test(value)) return 'open_mutual_help';
  if (/会议|开会|预约|约个时间|沟通时间/.test(value)) return 'create_meeting_record';
  if (/群聊|群里|待办|负责|谁来|截止/.test(value)) return 'create_group_todo';
  if (/进度|节点|补资料|阶段|完成|服务到哪/.test(value)) return 'create_progress_card';
  if (/需求|确认|范围|客户/.test(value)) return 'create_requirement_card';

  return 'create_card_from_chat';
}

function buildSkillLaunchUrl(name, params = {}) {
  const skill = getSkill(name) || SKILLS.create_card_from_chat;

  if (skill.name === 'open_mutual_help') {
    return `${skill.page}?source=${params.source || 'wechat_ai'}`;
  }

  const type = params.cardType || params.card_type || params.type || skill.defaultType || 'requirement';
  const source = params.source || 'wechat_ai';
  const context = encodeURIComponent(params.context || params.text || '');

  return `${skill.page}?source=${source}&type=${type}&context=${context}`;
}

module.exports = {
  SKILLS,
  getSkill,
  listSkills,
  inferSkillName,
  buildSkillLaunchUrl
};
