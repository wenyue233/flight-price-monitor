/**
 * 邮件通知模块。
 *
 * 默认 dry-run：只输出邮件标题和正文，不会真的发送。
 * 真实发送需要 MAIL_DRY_RUN=false，并配置 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_TO。
 */

const config = require('./config');
const { consoleInfo } = require('./utils/logger');

function formatPrice(price, currency) {
  return `${Number(price).toLocaleString('ja-JP')} ${currency}`;
}

function getChange(currentRecord, previousRecord) {
  if (!previousRecord) {
    return null;
  }

  const diff = currentRecord.price - previousRecord.price;
  if (diff === 0) {
    return null;
  }

  return {
    direction: diff > 0 ? '上涨' : '下降',
    amount: Math.abs(diff)
  };
}

function isEmailConfigured() {
  return Boolean(
    config.email.smtpHost &&
      config.email.smtpPort &&
      config.email.smtpUser &&
      config.email.smtpPass &&
      config.email.mailTo
  );
}

function buildEmail({ record, previousRecord, stats }) {
  const change = getChange(record, previousRecord);
  const belowTarget = record.price < config.alerts.targetPrice;
  const shouldNotify = Boolean(change || belowTarget);

  if (!shouldNotify) {
    return {
      shouldNotify: false,
      reason: '价格持平且未低于目标价'
    };
  }

  const direction = change ? change.direction : '低于目标价';
  const amount = change ? formatPrice(change.amount, record.currency) : '未与上次价格变化';
  const subject = `【机票价格变化】${config.route.departureAirport}⇄${config.route.arrivalAirport} 当前 ${formatPrice(record.price, record.currency)}`;
  const body = [
    `查询时间：${record.observedDate} ${record.observedTime}`,
    `当前价格：${formatPrice(record.price, record.currency)}`,
    `上次价格：${previousRecord ? formatPrice(previousRecord.price, previousRecord.currency) : '暂无上次价格'}`,
    `变化方向：${direction}`,
    `变化金额：${amount}`,
    `历史最低：${stats && stats.lowest_price !== null ? formatPrice(stats.lowest_price, record.currency) : '暂无数据'}`,
    `历史最高：${stats && stats.highest_price !== null ? formatPrice(stats.highest_price, record.currency) : '暂无数据'}`,
    `航线：${config.route.departureAirport} ⇄ ${config.route.arrivalAirport}`,
    `出发日期：${config.route.departureDate}`,
    `返回日期：${config.route.returnDate}`,
    `航司：${record.airline || record.outboundAirline || config.targetFlight.airline}`,
    `目标价：${formatPrice(config.alerts.targetPrice, record.currency)}`,
    `dashboard 链接：${config.dashboard.publicUrl}`
  ].join('\n');

  return {
    shouldNotify: true,
    subject,
    body
  };
}

async function maybeSendPriceEmail({ record, previousRecord, stats }) {
  const email = buildEmail({ record, previousRecord, stats });

  if (!email.shouldNotify) {
    consoleInfo(`邮件通知：${email.reason}，不发送。`);
    return { sent: false, skipped: true };
  }

  if (config.email.dryRun) {
    console.log('');
    console.log('[MAIL DRY-RUN] 标题：');
    console.log(email.subject);
    console.log('');
    console.log('[MAIL DRY-RUN] 正文：');
    console.log(email.body);
    console.log('');
    return { sent: false, dryRun: true };
  }

  if (!isEmailConfigured()) {
    consoleInfo('邮件未配置，跳过发送。');
    return { sent: false, skipped: true };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    consoleInfo('未安装 nodemailer，跳过发送。请执行 pnpm add nodemailer 后再启用真实邮件。');
    return { sent: false, skipped: true };
  }

  const transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpPort === 465,
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass
    }
  });

  await transporter.sendMail({
    from: config.email.smtpUser,
    to: config.email.mailTo,
    subject: email.subject,
    text: email.body
  });

  consoleInfo('邮件通知已发送。');
  return { sent: true };
}

module.exports = {
  buildEmail,
  maybeSendPriceEmail
};
