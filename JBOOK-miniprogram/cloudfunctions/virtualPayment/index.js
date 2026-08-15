// 虚拟支付云函数（微信虚拟支付 2.0，道具直购 short_series_goods 买断制会员）
// 三个入口：
//   prepareOrder  前端 wx.login 拿 code 后调用：jscode2session 换 session_key → 组装 signData → 双签名
//                 返回 { signData, paySig, signature, outTradeNo }，并在 payOrders 集合落 created 订单
//   confirmOrder  前端支付 success 后查单兜底：query_order 确认已支付 → 幂等开通会员
//   发货推送      控制台绑定消息推送 xpay_goods_deliver_notify 后，微信推送发货通知到本函数，
//                 query_order 二次确认 → 幂等开通 → 返回 { ErrCode: 0, ErrMsg: '' }
// 开通会员统一走 membership 云函数 grant（systemKey 系统通道），避免两套开通逻辑
const crypto = require('crypto');
const https = require('https');
const cloud = require('wx-server-sdk');
const config = require('./config');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ORDERS = 'payOrders';
const USERS = 'users';

// 当前支付环境对应的 AppKey（沙箱/现网二选一）
function currentAppKey() {
  return config.payEnv === 1 ? config.appKeySandbox : config.appKeyProd;
}

// HMAC-SHA256 签名（hex）
function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

// 生成商户订单号：8-32 位数字/字母，不用下划线开头（时间戳 base36 + 随机串）
function genOutTradeNo() {
  const ts = Date.now().toString(36).toUpperCase();
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += crypto.randomInt(36).toString(36).toUpperCase();
  }
  return (ts + rand).slice(0, 32);
}

// 通用 HTTPS 请求（GET/POST JSON），带超时与错误处理
function httpRequest(url, { method = 'GET', body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    // POST 必须显式声明 Content-Type/Content-Length，否则微信 API 返回空响应
    const headers = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(url, { method, timeout, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          // 解析失败时打出状态码与响应前 200 字符，便于定位（空响应/HTML 错误页等）
          reject(new Error(`响应解析失败: status=${res.statusCode} body=${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// jscode2session：用 wx.login 的 code 换 session_key（签名 signature 的密钥）
async function code2Session(code) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + `?appid=${config.appId}&secret=${config.appSecret}`
    + `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const data = await httpRequest(url);
  if (!data || !data.session_key) {
    console.error('[virtualPayment] jscode2session 失败', JSON.stringify(data));
    throw new Error('登录态换取失败: ' + ((data && data.errmsg) || '未知错误'));
  }
  return data.session_key;
}

// access_token 模块级缓存（7000 秒，微信有效期 7200 秒）
let tokenCache = { token: '', expireAt: 0 };
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expireAt > now) return tokenCache.token;
  const url = 'https://api.weixin.qq.com/cgi-bin/token'
    + `?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`;
  const data = await httpRequest(url);
  if (!data || !data.access_token) {
    console.error('[virtualPayment] 获取 access_token 失败', JSON.stringify(data));
    throw new Error('获取 access_token 失败: ' + ((data && data.errmsg) || '未知错误'));
  }
  tokenCache = { token: data.access_token, expireAt: now + 7000 * 1000 };
  return tokenCache.token;
}

// query_order 查单：确认订单是否已支付
// 入参 order 为 payOrders 订单记录（需 openid/outTradeNo）；appKey 按订单环境选择（混用会签名错误）
// 返回 { paid, transactionId, raw }；paid 判定：status===3（已支付）或 paid_fee>0（米大师报文字段 status/paid_fee）
async function queryOrder(order, appKey) {
  const accessToken = await getAccessToken();
  // 注意：服务端接口字段为下划线命名（offer_id/order_id/openid），与前端 signData 的驼峰不同
  const body = JSON.stringify({ offer_id: config.offerId, order_id: order.outTradeNo, openid: order._openid });
  // PAY_SIG = HMAC_SHA256(appKey, "/xpay/query_order&" + body 字符串)；uri 必须带前导斜杠（官方签名算法）
  const paySig = hmacSha256(appKey || currentAppKey(), '/xpay/query_order&' + body);
  const url = `https://api.weixin.qq.com/xpay/query_order?access_token=${accessToken}&pay_sig=${paySig}`;
  const data = await httpRequest(url, { method: 'POST', body });
  console.log('[virtualPayment] query_order 返回', order.outTradeNo, JSON.stringify(data));
  if (!data || data.errcode !== 0) {
    throw new Error('查单失败: ' + ((data && data.errmsg) || '未知错误'));
  }
  const o = data.order || {};
  return {
    paid: Number(o.status) === 3 || Number(o.paid_fee) > 0,
    transactionId: o.wx_order_id || '',
    raw: o
  };
}

// 按订单环境选择 AppKey（订单落库时记录了 env）
function appKeyOfOrder(order) {
  return (order && order.env === 0) ? config.appKeyProd : config.appKeySandbox;
}

// 退款：query_order 查剩余可退金额后发起 refund_order（现网订单用现网 key、env=0）
async function refundOrder(order) {
  const appKey = appKeyOfOrder(order);
  const q = await queryOrder(order, appKey);
  const raw = q.raw || {};
  const leftFee = Number(raw.left_fee != null ? raw.left_fee : order.priceFen);
  if (!raw.openid && !order._openid) {
    throw new Error('缺少 openid，无法退款');
  }
  const body = JSON.stringify({
    openid: raw.openid || order._openid,
    order_id: order.outTradeNo,
    refund_order_id: 'R' + Date.now().toString(36).toUpperCase(),
    left_fee: leftFee,
    refund_fee: leftFee,
    biz_meta: '',
    refund_reason: '3',
    req_from: '1',
    env: order.env === 0 ? 0 : 1
  });
  const accessToken = await getAccessToken();
  const paySig = hmacSha256(appKey, '/xpay/refund_order&' + body);
  const url = `https://api.weixin.qq.com/xpay/refund_order?access_token=${accessToken}&pay_sig=${paySig}`;
  const data = await httpRequest(url, { method: 'POST', body });
  console.log('[virtualPayment] refund_order 返回', order.outTradeNo, JSON.stringify(data));
  return data;
}

// 临时运维入口（systemKey 鉴权）：recentOrders 查订单 / queryRaw 原始报文 / refund 退款
async function adminOps(event) {
  if (event.op === 'recentOrders') {
    const res = await db.collection(ORDERS).orderBy('createdAt', 'desc').limit(10).get();
    return {
      code: 0,
      data: res.data.map((o) => ({
        outTradeNo: o.outTradeNo, plan: o.plan, status: o.status,
        priceFen: o.priceFen, env: o.env, openid: o._openid, createdAt: o.createdAt
      }))
    };
  }
  if (event.op === 'resetMember') {
    // 重置会员状态为未开通（测试用）：清空 membership，保留 memberCode；不需要订单
    const res = await db.collection(USERS).where({ _openid: event.targetOpenid || '' }).limit(1).get();
    const user = res.data && res.data[0];
    if (!user) return { code: -1, message: '用户不存在' };
    await db.collection(USERS).doc(user._id).update({
      data: { membership: { plan: '', status: 'none', expireAt: 0, updatedAt: Date.now() }, updatedAt: Date.now() }
    });
    return { code: 0, data: { reset: true } };
  }
  const order = await getOrder(event.outTradeNo || '');
  if (!order) return { code: -1, message: '订单不存在' };
  if (event.op === 'queryRaw') {
    const q = await queryOrder(order, appKeyOfOrder(order));
    return { code: 0, data: q.raw };
  }
  if (event.op === 'refund') {
    return { code: 0, data: await refundOrder(order) };
  }
  if (event.op === 'activate') {
    // 补开：对已支付未开通的订单手动触发开通（修复期间的补救通道）
    const q = await queryOrder(order, appKeyOfOrder(order));
    if (!q.paid) return { code: -1, message: '订单未支付，不能补开' };
    return { code: 0, data: await activateMembership(order, q.transactionId) };
  }
  return { code: -1, message: '未知 op' };
}

// 开通会员（幂等）：先乐观锁把 payOrders 置 paid，未抢占到锁说明已开通过，直接返回
// 抢占成功后调 membership.grant 完成开通（membership 内部负责档位/流水/站内信）
async function activateMembership(order, transactionId) {
  const now = Date.now();
  const lock = await db.collection(ORDERS).where({
    outTradeNo: order.outTradeNo,
    status: _.neq('paid')
  }).update({
    data: {
      status: 'paid',
      paidAt: now,
      transactionId: transactionId || ''
    }
  });
  if (!lock.stats || !lock.stats.updated) {
    console.log('[virtualPayment] 订单已开通过，幂等跳过', order.outTradeNo);
    return { already: true };
  }

  console.log('[virtualPayment] 开始开通会员', order.outTradeNo, order._openid, order.plan);
  // test 测试档位（1 元道具）不在 membership 的 PLANS 里，走兼容入参 days=1（1 天体验），
  // 仅供支付链路自测；正式档位 monthly/yearly/lifetime 原样透传 plan
  const grantData = {
    action: 'grant',
    targetOpenid: order._openid,
    remark: '虚拟支付自动开通 ' + order.outTradeNo,
    systemKey: config.systemKey
  };
  if (order.plan === 'test') {
    grantData.days = 1;
  } else {
    grantData.plan = order.plan;
  }
  const grantRes = await cloud.callFunction({ name: 'membership', data: grantData });
  const result = (grantRes && grantRes.result) || {};
  if (result.code !== 0) {
    // 开通失败：把订单状态回滚为 created，允许 confirmOrder 再次重试
    console.error('[virtualPayment] membership.grant 失败，回滚订单状态', JSON.stringify(result));
    await db.collection(ORDERS).where({ outTradeNo: order.outTradeNo }).update({
      data: { status: 'created' }
    });
    throw new Error('会员开通失败: ' + (result.message || '未知错误'));
  }
  console.log('[virtualPayment] 会员开通成功', order.outTradeNo);
  return { already: false, data: result.data };
}

// 查 payOrders 订单
async function getOrder(outTradeNo) {
  const res = await db.collection(ORDERS).where({ outTradeNo }).limit(1).get();
  return res.data && res.data[0];
}

// action: prepareOrder
// 入参 { plan, code }（plan=monthly/yearly/lifetime/test，code 来自 wx.login）
// 返回 { signData, paySig, signature, outTradeNo }
async function prepareOrder(openid, event) {
  const plan = (event.plan || '').trim();
  const code = (event.code || '').trim();
  const planCfg = config.plans[plan];
  if (!planCfg) {
    return { code: -1, message: '无效的会员档位' };
  }
  if (!code) {
    return { code: -1, message: '缺少 code 参数' };
  }

  const sessionKey = await code2Session(code);
  const outTradeNo = genOutTradeNo();

  // signData（JSON 字符串）：金额单位分，必须与虚拟支付后台道具价一致
  const signData = JSON.stringify({
    offerId: config.offerId,
    buyQuantity: 1,
    env: config.payEnv,
    currencyType: 'CNY',
    productId: planCfg.productId,
    goodsPrice: planCfg.priceFen,
    outTradeNo,
    attach: plan
  });

  // 双签名：paySig 用 AppKey，signature 用 session_key
  const paySig = hmacSha256(currentAppKey(), 'requestVirtualPayment&' + signData);
  const signature = hmacSha256(sessionKey, signData);

  // 落订单记录（created 态，开通后由 activateMembership 置 paid；env 用于查单/退款选 AppKey）
  await db.collection(ORDERS).add({
    data: {
      _openid: openid,
      outTradeNo,
      plan,
      productId: planCfg.productId,
      priceFen: planCfg.priceFen,
      env: config.payEnv,
      status: 'created',
      createdAt: Date.now()
    }
  });

  console.log('[virtualPayment] prepareOrder 成功', outTradeNo, plan, 'env=' + config.payEnv);
  return { code: 0, data: { signData, paySig, signature, outTradeNo } };
}

// action: confirmOrder（查单兜底，支付 success 后前端轮询调用）
// 入参 { outTradeNo }；幂等：已开通直接返回最新状态
async function confirmOrder(openid, event) {
  const outTradeNo = (event.outTradeNo || '').trim();
  if (!outTradeNo) {
    return { code: -1, message: '缺少 outTradeNo' };
  }

  const order = await getOrder(outTradeNo);
  if (!order) {
    return { code: -1, message: '订单不存在' };
  }
  // 归属校验：只能确认本人的订单
  if (order._openid !== openid) {
    return { code: -1, message: '订单归属校验失败' };
  }

  if (order.status === 'paid') {
    // 已开通（可能由发货推送先完成），直接返回成功
    console.log('[virtualPayment] confirmOrder 幂等命中', outTradeNo);
    return { code: 0, data: { paid: true, outTradeNo } };
  }

  const { paid, transactionId } = await queryOrder(order, appKeyOfOrder(order));
  if (!paid) {
    console.log('[virtualPayment] confirmOrder 订单未支付', outTradeNo);
    return { code: 0, data: { paid: false, outTradeNo } };
  }

  await activateMembership(order, transactionId);
  return { code: 0, data: { paid: true, outTradeNo } };
}

// 发货推送入口：控制台绑定消息推送 xpay_goods_deliver_notify 后由微信触发
// 云函数消息推送模式下 event 为微信推送的消息体；字段命名兼容驼峰/下划线
async function handleDeliverNotify(event) {
  const outTradeNo = event.OutTradeNo || event.out_trade_no || '';
  const openid = event.OpenId || event.openid || '';
  console.log('[virtualPayment] 收到发货推送', outTradeNo, openid);

  if (!outTradeNo) {
    console.error('[virtualPayment] 发货推送缺少订单号');
    return { ErrCode: -1, ErrMsg: 'missing out_trade_no' };
  }

  try {
    const order = await getOrder(outTradeNo);
    if (!order) {
      console.error('[virtualPayment] 发货推送订单不存在', outTradeNo);
      return { ErrCode: -1, ErrMsg: 'order not found' };
    }
    if (order.status === 'paid') {
      // 幂等：已开通直接回成功，避免微信重推
      return { ErrCode: 0, ErrMsg: '' };
    }
    // query_order 二次确认已支付（不轻信推送报文本身）
    const { paid, transactionId } = await queryOrder(order, appKeyOfOrder(order));
    if (!paid) {
      console.error('[virtualPayment] 发货推送查单未支付', outTradeNo);
      return { ErrCode: -1, ErrMsg: 'order not paid' };
    }
    await activateMembership(order, transactionId);
    return { ErrCode: 0, ErrMsg: '' };
  } catch (err) {
    console.error('[virtualPayment] 发货推送处理异常', err);
    return { ErrCode: -1, ErrMsg: err.message || 'internal error' };
  }
}

exports.main = async (event, context) => {
  // 消息推送（发货通知）：event.Event 为推送事件名，无 action
  if (!event.action && (event.Event === 'xpay_goods_deliver_notify' || event.OutTradeNo || event.out_trade_no)) {
    return await handleDeliverNotify(event);
  }

  console.log('[virtualPayment] 收到请求', JSON.stringify({ action: event.action }));

  // 临时运维通道（systemKey 鉴权，无需用户上下文）：recentOrders/queryRaw/refund
  if (event.action === 'adminOps') {
    if ((event.systemKey || '') !== config.systemKey) {
      return { code: -1, message: '无权访问' };
    }
    try {
      return await adminOps(event);
    } catch (err) {
      console.error('[virtualPayment] adminOps 错误', err);
      return { code: -1, message: '运维操作失败: ' + (err.message || '') };
    }
  }

  const openid = cloud.getWXContext().OPENID;
  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  try {
    switch (event.action) {
      case 'prepareOrder':
        return await prepareOrder(openid, event);
      case 'confirmOrder':
        return await confirmOrder(openid, event);
      default:
        return { code: -1, message: '未知 action' };
    }
  } catch (err) {
    console.error('[virtualPayment] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || JSON.stringify(err)) };
  }
};
