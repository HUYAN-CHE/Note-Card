// 一次性数据修正（2026-08-08）：撤回"订阅自动开启 reminderEnabled"错误改动留下的脏数据，
// 把 users 表中被错误置为 true 的 reminderEnabled 全部恢复为 false（开关默认关，用户手动开）。
// 运行一次后即可删除本函数。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  try {
    const res = await db.collection('users')
      .where({ reminderEnabled: true })
      .update({ data: { reminderEnabled: false } });
    return { code: 0, message: 'success', updated: res.stats ? res.stats.updated : 0 };
  } catch (e) {
    return { code: -1, message: e.message || '修正失败' };
  }
};
