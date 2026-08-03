// 会员云函数：getStatus 查询当前用户会员状态 / grant 管理员手动开通或续期
// 数据模型：users.membership = { plan: 'yearly', status: 'active'|'expired', expireAt: 时间戳, updatedAt }
// 开通记录：membershipOrders = { targetOpenid, days, plan, remark, operatorOpenid, createdAt }
// MVP 阶段支付走企微「对外收款」（人工），收款后管理员用 grant 开通；支付自动化后接同一模型
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS = 'users';
const ORDERS = 'membershipOrders';

// 管理员判定：查 admins 集合（该集合权限应为「所有用户不可读写」，仅服务端/控制台可写，
// 防止用户在小程序端篡改自己的 users 记录自封管理员）
async function isAdmin(openid) {
  try {
    const res = await db.collection('admins').where({ openid }).limit(1).get();
    return !!(res.data && res.data.length);
  } catch (err) {
    // 集合不存在等情况按非管理员处理
    console.warn('[isAdmin] 查询失败', err.message || err);
    return false;
  }
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
        return { code: 0, data: { isAdmin: await isAdmin(openid) } };
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
  if (!(await isAdmin(operatorOpenid))) {
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

  // 订单流水：集合需预先在控制台创建；写入失败不阻塞开通结果，仅记日志
  try {
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
  } catch (err) {
    console.warn('[grant] 订单流水写入失败（不影响开通）', err.message || err);
  }

  const status = await getStatus(targetOpenid);
  return { code: 0, data: status.data };
}

// 管理员列用户（含会员状态），支持昵称模糊搜索；管理页用
async function listUsers(operatorOpenid, event) {
  if (!(await isAdmin(operatorOpenid))) {
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
