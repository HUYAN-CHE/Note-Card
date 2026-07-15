const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function uid(prefix = 'card') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function nowText() {
  const date = new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const {
    title = '',
    desc = '',
    keyPoints = [],
    status = 'draft',
    isNetworkVisible = true,
    source = 'manual',
    attachmentFileIDs = [],
    files = []
  } = event;

  if (!title.trim()) {
    return { code: -2, message: '标题不能为空' };
  }

  const now = Date.now();
  const card = {
    id: uid(),
    title: title.trim(),
    desc: desc.trim(),
    keyPoints: Array.isArray(keyPoints) ? keyPoints.filter(Boolean) : [],
    status,
    creatorId: openid,
    helperIds: [],
    isNetworkVisible,
    source,
    attachmentFileIDs: Array.isArray(attachmentFileIDs) ? attachmentFileIDs.filter(Boolean) : [],
    files: Array.isArray(files) ? files.filter(Boolean) : [],
    createdAt: now,
    updatedAt: now,
    updatedText: nowText()
  };

  try {
    const res = await db.collection('cards').add({ data: card });
    return {
      code: 0,
      message: 'success',
      data: {
        ...card,
        _id: res._id
      }
    };
  } catch (error) {
    return { code: -3, message: error.message || '创建失败' };
  }
};
