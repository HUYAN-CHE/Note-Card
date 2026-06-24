const { buildDraftFromContext } = require('../../services/ai-adapter');
const { createCardFromDraft } = require('../../utils/store');

Page({
  data: {
    form: {
      customerName: '',
      phone: '',
      need: ''
    }
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`form.${field}`]: event.detail.value
    });
  },

  async submitNeed() {
    const form = this.data.form;

    if (!form.need.trim()) {
      wx.showToast({
        title: '请先填写需求',
        icon: 'none'
      });
      return;
    }

    const draft = buildDraftFromContext({
      text: `客户：${form.customerName}\n手机号：${form.phone}\n需求：${form.need}`,
      type: 'requirement',
      source: 'profile_card'
    });

    const card = await createCardFromDraft({
      ...draft,
      customerName: form.customerName || draft.customerName,
      phone: form.phone || draft.phone,
      status: 'pending_merchant_review',
      stage: '待商家整理'
    });

    wx.showToast({
      title: '已生成需求卡',
      icon: 'success'
    });

    setTimeout(() => {
      wx.navigateTo({
        url: `/pages/customer-confirm/customer-confirm?id=${card.id}&preview=1`
      });
    }, 600);
  },

  bookMeeting() {
    wx.navigateTo({
      url: '/pages/intake/intake?type=meeting&source=profile_card'
    });
  },

  onShareAppMessage() {
    return {
      title: '张三的服务名片｜说说你的需求',
      path: '/pages/profile-card/profile-card',
      imageUrl: '/assets/logo.png'
    };
  }
});
