// 会员云函数：
//   getStatus    查询当前用户会员状态（含企微绑定状态与会员码）
//   grant        管理员手动开通或续期（plan: monthly/yearly/lifetime，兼容旧入参 days）；
//                支持 systemKey 系统通道（virtualPayment 虚拟支付自动开通走此通道，跳过管理员校验）
//   bindPhone    绑定手机号
//   bindByCode   会员码绑定（主路径：会员把会员码发给企微私人助理，会话存档服务识别后调本接口）
//   unbind       解绑企微（换绑用），会员码保持不变
// 数据模型：users.membership = { plan: 'monthly'|'yearly'|'lifetime', status: 'active'|'expired', expireAt: 时间戳, updatedAt }
//   lifetime 终身不过期，expireAt 存 4102416000000（2100-01-01）占位，getStatus 对 lifetime 不做过期判断
// 会员码（users.memberCode）：
//   会员码 = 会员身份证 + 绑定码合一，8 位 Crockford，grant 开通时生成，永久有效
//   码是身份不随会员过期失效；权益（membership.active）会过期，两者分离
// 企微绑定字段（users）：
//   externalUserid 企微外部联系人ID（存在即视为已绑定）/ wecomBoundAt 绑定时间戳
//   注：企微回调路径（动态 state/时间窗）因无备案域名被域名主体校验拦截，已放弃（2026-08-11）
// 手机号：users.phoneNumber 存明文（仅云函数读写），getStatus 只回脱敏版 phoneMasked
// 开通记录：membershipOrders = { targetOpenid, days, plan, remark, operatorOpenid, createdAt }
// MVP 阶段支付走企微「对外收款」（人工），收款后管理员用 grant 开通；支付自动化后接同一模型
const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS = 'users';
const ORDERS = 'membershipOrders';

// 会员档位：罐头月卡 30 天 / 罐头年卡 365 天 / 罐头创始卡终身不过期
const PLANS = {
  monthly: { label: '罐头月卡', days: 30 },
  yearly: { label: '罐头年卡', days: 365 },
  lifetime: { label: '罐头创始卡', days: 0 }
};
// 终身会员 expireAt 占位：2100-01-01（getStatus 对 lifetime 特判不过期，此值仅作存储约定）
const LIFETIME_EXPIRE_AT = 4102416000000;

// 系统通道凭证：供 virtualPayment 云函数间调用 grant 用（前端无法伪造云函数上下文，拿不到该值）
// 与 virtualPayment/config.js 的 systemKey 保持一致，process.env.PAY_SYSTEM_KEY 优先
const PAY_SYSTEM_KEY = process.env.PAY_SYSTEM_KEY || 'jishika-pay-2026';

// Crockford Base32 字符集（去除易混淆的 I L O U）
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 生成 8 位会员码（Crockford），生成后查 users 集合确保全局唯一，碰撞则重生成
async function genMemberCode() {
  for (let i = 0; i < 5; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) s += CROCKFORD[crypto.randomInt(CROCKFORD.length)];
    const dup = await db.collection(USERS).where({ memberCode: s }).limit(1).get();
    if (!dup.data || !dup.data.length) return s;
  }
  // 32^8 空间下几乎不可能走到，兜底报错交由上层重试
  throw new Error('会员码生成冲突，请重试');
}

// 写消息到收件箱；失败仅打日志，不影响主流程
async function writeMessage(openid, type, { title, content, cardId, requestId }) {
  try {
    if (!openid) return;
    await db.collection('messages').add({
      data: {
        _openid: openid,
        type,
        title,
        content: content || '',
        cardId: cardId || '',
        requestId: requestId || '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('writeMessage error', e);
  }
}

function formatDateText(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 手机号脱敏：前 3 后 4，中间 ****（明文只存库，不回传前端）
function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

// openid 脱敏：前 4 后 4（bindByCode 等服务端接口不回传完整 openid）
function maskOpenid(openid) {
  const p = String(openid || '');
  if (p.length < 9) return p;
  return p.slice(0, 4) + '****' + p.slice(-4);
}

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

// 确保用户有会员码：没有则生成写入；用户记录不存在时顺带建档
// （云函数端 add 不会自动填充 _openid，必须显式写入，否则产生脏记录且 where({_openid}) 查不到）
async function ensureMemberCode(user, openid) {
  if (user && user.memberCode) return user.memberCode;
  const memberCode = await genMemberCode();
  const now = Date.now();
  if (user) {
    await db.collection(USERS).doc(user._id).update({ data: { memberCode, updatedAt: now } });
  } else {
    await db.collection(USERS).add({
      data: { _openid: openid, memberCode, createdAt: now, updatedAt: now }
    });
  }
  return memberCode;
}

exports.main = async (event, context) => {
  console.log('[membership] 收到请求', JSON.stringify({ action: event.action }));

  const openid = cloud.getWXContext().OPENID;
  // bindByCode 由服务端（未来会话存档云函数）调用，无小程序用户上下文，凭 code 定位用户，无需 openid
  // grant 的系统通道（virtualPayment 云函数间调用自动开通）：无 openid 时凭 systemKey 放行
  // （前端调用必带用户上下文，无 openid + 正确 systemKey 只可能来自云函数间调用，无法伪造）
  if (!openid && event.action !== 'bindByCode') {
    const isSystemGrant = event.action === 'grant' && (event.systemKey || '') === PAY_SYSTEM_KEY;
    if (!isSystemGrant) {
      return { code: -1, message: '未获取到用户身份' };
    }
  }

  try {
    switch (event.action) {
      case 'getStatus':
        return await getStatus(openid);
      case 'grant':
        return await grant(openid, event);
      case 'bindPhone':
        return await bindPhone(openid, event);
      case 'bindByCode':
        return await bindByCode(event);
      case 'unbind':
        return await unbind(openid);
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

// 查询会员状态：无记录 none / 有效期内 active / 已过期 expired；lifetime 恒 active 不过期
// 附带手机号绑定状态（hasPhone + 脱敏 phoneMasked）与企微绑定状态（hasWecomBound + wecomBoundAt）
// 会员码：仅有会员记录（active/expired）时返回 memberCode；历史无码的会员记录在此补生成写入；
// 非会员 none 不生成不返回
async function getStatus(openid) {
  const res = await db.collection(USERS).where({ _openid: openid }).limit(1).get();
  const user = res.data && res.data[0];
  const m = user && user.membership;
  const phone = {
    hasPhone: !!(user && user.phoneNumber),
    phoneMasked: user && user.phoneNumber ? maskPhone(user.phoneNumber) : ''
  };
  const wecom = {
    hasWecomBound: !!(user && user.externalUserid),
    wecomBoundAt: (user && user.wecomBoundAt) || 0
  };
  // 订阅消息剩余额度（会员页展示与充值引导用）
  const quota = { subscribeCount: (user && user.subscribeCount) || 0 };

  if (!m || !m.expireAt) {
    return { code: 0, data: { isMember: false, status: 'none', ...wecom, ...phone, ...quota } };
  }

  // 有会员记录（含已过期）才下发会员码；历史数据无码的现场补生成
  const memberCode = await ensureMemberCode(user, openid);

  // 终身会员特判：不过期，daysLeft 无意义返回 null
  if (m.plan === 'lifetime') {
    return {
      code: 0,
      data: {
        isMember: true,
        status: 'active',
        plan: 'lifetime',
        expireAt: m.expireAt,
        daysLeft: null,
        memberCode,
        ...wecom,
        ...phone,
        ...quota
      }
    };
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
        daysLeft: Math.ceil((m.expireAt - now) / 86400000),
        memberCode,
        ...wecom,
        ...phone,
        ...quota
      }
    };
  }

  return { code: 0, data: { isMember: false, status: 'expired', expireAt: m.expireAt, memberCode, ...wecom, ...phone, ...quota } };
}

// 绑定/换绑手机号：入参 code 来自前端 getPhoneNumber 组件回调，
// 用 openapi 换真实号码写入 users.phoneNumber，返回脱敏版
async function bindPhone(openid, event) {
  const code = (event.code || '').trim();
  if (!code) {
    return { code: -1, message: '缺少 code 参数' };
  }

  let phoneNumber = '';
  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    phoneNumber = res && res.phoneInfo && res.phoneInfo.phoneNumber;
  } catch (err) {
    console.error('[bindPhone] 手机号换取失败', err);
    return { code: -1, message: '手机号换取失败，请重试' };
  }
  if (!phoneNumber) {
    return { code: -1, message: '未获取到手机号' };
  }

  const now = Date.now();
  const res = await db.collection(USERS).where({ _openid: openid }).limit(1).get();
  const doc = res.data && res.data[0];
  if (doc) {
    await db.collection(USERS).doc(doc._id).update({ data: { phoneNumber, updatedAt: now } });
  } else {
    // 云函数端 add 不会自动填充 _openid（仅小程序端会），必须显式写入，
    // 否则产生 _openid 为空的脏记录，且后续 where({_openid}) 查不到会重复 add
    await db.collection(USERS).add({
      data: { _openid: openid, phoneNumber, createdAt: now, updatedAt: now }
    });
  }

  return { code: 0, data: { phoneMasked: maskPhone(phoneNumber) } };
}

// 会员码绑定：会员把 8 位会员码发给企微私人助理，会话存档服务识别后调本接口
// 入参 { code, externalUserid }；凭会员码定位用户，无小程序用户上下文
async function bindByCode(event) {
  const code = (event.code || '').trim().toUpperCase();
  const externalUserid = (event.externalUserid || '').trim();
  if (!code || !externalUserid) {
    return { code: -1, message: '缺少 code 或 externalUserid' };
  }

  const res = await db.collection(USERS).where({ memberCode: code }).limit(1).get();
  const doc = res.data && res.data[0];
  if (!doc) {
    return { code: -1, message: '会员码无效' };
  }

  // 防护：该会员码对应用户已绑定其他企微账号，拒绝直接覆盖（换绑需先在小程序解绑）
  if (doc.externalUserid && doc.externalUserid !== externalUserid) {
    return { code: -1, message: '该会员码已完成绑定，如需换绑请先在小程序操作', data: { conflict: true } };
  }

  // 防重：该 externalUserid 已绑定其他用户时返回冲突（同一用户重复提交幂等放行）
  const dup = await db.collection(USERS).where({ externalUserid }).limit(1).get();
  const dupDoc = dup.data && dup.data[0];
  if (dupDoc && dupDoc._openid !== doc._openid) {
    return { code: -1, message: '该企微账号已绑定其他用户', data: { conflict: true } };
  }

  const now = Date.now();
  await db.collection(USERS).doc(doc._id).update({
    data: {
      externalUserid,
      wecomBoundAt: now,
      updatedAt: now
    }
  });

  return {
    code: 0,
    data: {
      bound: true,
      openidMasked: maskOpenid(doc._openid),
      wecomBoundAt: now
    }
  };
}

// 解绑企微（换绑用）：清空绑定关系，会员码保持不变（永久码，不随解绑/过期变化）
async function unbind(openid) {
  const res = await db.collection(USERS).where({ _openid: openid }).limit(1).get();
  const doc = res.data && res.data[0];
  if (!doc) {
    return { code: -1, message: '用户记录不存在' };
  }

  const now = Date.now();
  await db.collection(USERS).doc(doc._id).update({
    data: {
      externalUserid: '',
      wecomBoundAt: 0,
      updatedAt: now
    }
  });

  return await getStatus(openid);
}

// 管理员手动开通/续期：targetOpenid 为目标用户；plan 为 monthly/yearly/lifetime
// （lifetime 存占位 expireAt 不过期）；兼容旧入参：只传 days 未传 plan 时按原逻辑（默认年卡）
// 当前仍在有效期内的，在现有 expireAt 上累加；否则从当前时间起算（lifetime 直接覆盖为占位值）
async function grant(operatorOpenid, event) {
  // 系统通道：virtualPayment 云函数间调用时凭 systemKey 跳过管理员校验
  // （systemKey 只存在于云函数配置/环境变量中，前端调用拿不到，无法伪造）
  const isSystem = (event.systemKey || '') === PAY_SYSTEM_KEY;
  if (!isSystem && !(await isAdmin(operatorOpenid))) {
    return { code: -1, message: '无权限：仅管理员可开通' };
  }

  const targetOpenid = (event.targetOpenid || '').trim();
  const remark = (event.remark || '').trim();
  if (!targetOpenid) {
    return { code: -1, message: '缺少 targetOpenid' };
  }

  const now = Date.now();
  const res = await db.collection(USERS).where({ _openid: targetOpenid }).limit(1).get();
  const doc = res.data && res.data[0];
  const currentExpire = doc && doc.membership && doc.membership.expireAt;
  const base = currentExpire && currentExpire > now ? currentExpire : now;

  const planCfg = PLANS[(event.plan || '').trim()];
  let plan, days, expireAt;
  if (planCfg) {
    plan = (event.plan || '').trim();
    days = planCfg.days;
    expireAt = plan === 'lifetime' ? LIFETIME_EXPIRE_AT : base + days * 86400000;
  } else {
    // 兼容旧入参 days：未传 plan 时按原逻辑，默认年卡
    plan = 'yearly';
    days = Number(event.days) || 365;
    expireAt = base + days * 86400000;
  }

  const membership = {
    plan,
    status: 'active',
    expireAt,
    updatedAt: now
  };

  let userId = doc && doc._id;
  if (doc) {
    await db.collection(USERS).doc(doc._id).update({ data: { membership, updatedAt: now } });
  } else {
    const added = await db.collection(USERS).add({
      data: { _openid: targetOpenid, membership, createdAt: now, updatedAt: now }
    });
    userId = added._id;
  }

  // 会员码：开通/续期时若用户尚无码则生成（终身/月/年都一样，生成后永久有效）
  if (!doc || !doc.memberCode) {
    const memberCode = await genMemberCode();
    await db.collection(USERS).doc(userId).update({ data: { memberCode, updatedAt: now } });
  }

  // 订单流水：集合需预先在控制台创建；写入失败不阻塞开通结果，仅记日志
  try {
    await db.collection(ORDERS).add({
      data: {
        targetOpenid,
        days,
        plan,
        remark,
        operatorOpenid,
        createdAt: now
      }
    });
  } catch (err) {
    console.warn('[grant] 订单流水写入失败（不影响开通）', err.message || err);
  }

  const status = await getStatus(targetOpenid);

  // 消息中心：开通/续费成功通知本人（到期为被动检测，无主动触发点，不写消息）
  const wasActive = currentExpire && currentExpire > now;
  const label = planCfg ? planCfg.label : '年卡';
  let content;
  if (plan === 'lifetime') {
    content = wasActive ? `${label}已续费，终身有效` : `${label}已开通，终身有效`;
  } else {
    content = wasActive
      ? `${label}已续费 ${days} 天，有效期至 ${formatDateText(expireAt)}`
      : `${label}已开通，有效期至 ${formatDateText(expireAt)}`;
  }
  await writeMessage(targetOpenid, 'member', {
    title: wasActive ? '会员已续费' : '会员已开通',
    content
  });

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
      plan: m.plan || '',
      expireAt: m.expireAt || 0,
      // 会员码：客服按码查人用，无码用户返回空串
      memberCode: u.memberCode || '',
      // 企微绑定状态：管理页展示与模拟绑定测试用
      hasWecomBound: !!u.externalUserid,
      externalUserid: u.externalUserid || ''
    };
  });

  return { code: 0, data: { users } };
}
