// 会员云函数：getStatus 查询当前用户会员状态 / grant 管理员手动开通或续期
// 数据模型：users.membership = { plan: 'yearly', status: 'active'|'expired', expireAt: 时间戳, updatedAt }
// 开通记录：membershipOrders = { targetOpenid, days, plan, remark, operatorOpenid, createdAt }
// MVP 阶段支付走企微「对外收款」（人工），收款后管理员用 grant 开通；支付自动化后接同一模型
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS = 'users';
const ORDERS = 'membershipOrders';

// 管理员 openid 白名单：部署后在云函数环境变量 ADMIN_OPENIDS 配置（逗号分隔）
function adminOpenids() {
  return (process.env.ADMIN_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

exports.main = async (event, context) => {
  console.log('[membership] 收到请求', JSON.stringify({ action: event.action }));

  const openid = cloud.getWXContext().OPENID;
  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  try {
    switch (event.action) {
      case 'getStatus':
        return await getStatus(openid);
      case 'grant':
        return await grant(openid, event);
      case 'checkAdmin':
        return { code: 0, data: { isAdmin: adminOpenids().indexOf(openid) !== -1 } };
      case 'listUsers':
        return await listUsers(openid, event);
      default:
        return { code: -1, message: '未知 action' };
    }
  } catch (err) {
    console.error('[membership] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || JSON.stringify(err)) };
  }
};

// 查询会员状态：无记录 none / 有效期内 active / 已过期 expired
async function getStatus(openid) {
  const res = await db.collection(USERS).where({ _openid: openid }).limit(1).get();
  const m = res.data && res.data[0] && res.data[0].membership;

  if (!m || !m.expireAt) {
    return { code: 0, data: { isMember: false, status: 'none' } };
  }

  const now = Date.now();
  if (m.expireAt > now) {
    return {
      code: 0,
      data: {
        isMember: true,
        status: 'active',
        plan: m.plan || 'yearly',
        expireAt: m.expireAt,
        daysLeft: Math.ceil((m.expireAt - now) / 86400000)
      }
    };
  }

  return { code: 0, data: { isMember: false, status: 'expired', expireAt: m.expireAt } };
}

// 管理员手动开通/续期：targetOpenid 为目标用户，days 为有效天数
// 当前仍在有效期内的，在现有 expireAt 上累加；否则从当前时间起算
async function grant(operatorOpenid, event) {
  if (adminOpenids().indexOf(operatorOpenid) === -1) {
    return { code: -1, message: '无权限：仅管理员可开通' };
  }

  const targetOpenid = (event.targetOpenid || '').trim();
  const days = Number(event.days) || 365;
  const remark = (event.remark || '').trim();
  if (!targetOpenid) {
    return { code: -1, message: '缺少 targetOpenid' };
  }

  const now = Date.now();
  const res = await db.collection(USERS).where({ _openid: targetOpenid }).limit(1).get();
  const doc = res.data && res.data[0];
  const currentExpire = doc && doc.membership && doc.membership.expireAt;
  const base = currentExpire && currentExpire > now ? currentExpire : now;
  const membership = {
    plan: 'yearly',
    status: 'active',
    expireAt: base + days * 86400000,
    updatedAt: now
  };

  if (doc) {
    await db.collection(USERS).doc(doc._id).update({ data: { membership, updatedAt: now } });
  } else {
    await db.collection(USERS).add({
      data: { _openid: targetOpenid, membership, createdAt: now, updatedAt: now }
    });
  }

  await db.collection(ORDERS).add({
    data: {
      targetOpenid,
      days,
      plan: 'yearly',
      remark,
      operatorOpenid,
      createdAt: now
    }
  });

  const status = await getStatus(targetOpenid);
  return { code: 0, data: status.data };
}

// 管理员列用户（含会员状态），支持昵称模糊搜索；管理页用
async function listUsers(operatorOpenid, event) {
  if (adminOpenids().indexOf(operatorOpenid) === -1) {
    return { code: -1, message: '无权限：仅管理员可查看' };
  }

  const keyword = (event.keyword || '').trim();
  let query = db.collection(USERS);
  if (keyword) {
    query = query.where({
      nickName: db.RegExp({ regexp: keyword, options: 'i' })
    });
  }

  const res = await query.orderBy('updatedAt', 'desc').limit(50).get();
  const now = Date.now();
  const users = res.data.map((u) => {
    const m = u.membership || {};
    const active = m.expireAt && m.expireAt > now;
    return {
      openid: u._openid,
      nickName: u.nickName || '未授权用户',
      avatarUrl: u.avatarUrl || '',
      isMember: !!active,
      status: !m.expireAt ? 'none' : (active ? 'active' : 'expired'),
      expireAt: m.expireAt || 0
    };
  });

  return { code: 0, data: { users } };
}
