/**
 * Trip.com Playwright 抓取器。
 *
 * 注意：
 * 1. 这里不会调用 Trip.com 私有 API。
 * 2. 程序会真实打开网页，并从渲染后的页面读取价格。
 * 3. Trip.com 页面结构可能变化，所以价格抽取使用多种策略；
 *    如果全部失败，会保存截图、HTML 和详细日志，而不是直接静默崩溃。
 */

const path = require('path');
const { chromium } = require('playwright');
const BaseScraper = require('./BaseScraper');
const config = require('../config');
const { timestampForFile } = require('../utils/time');
const { ensureLogDirs, writeDebugHtml, writeJsonLog } = require('../utils/logger');

class TripScraper extends BaseScraper {
  constructor(options = {}) {
    super({ siteName: config.trip.siteName });
    this.options = { ...config.trip, ...options };
  }

  buildSearchUrl(route) {
    const url = new URL('/flights/showfarefirst', this.options.baseUrl);
    const isRoundTrip = Boolean(route.returnDate);

    url.searchParams.set('dcity', route.departureAirport.toLowerCase());
    url.searchParams.set('acity', route.arrivalAirport.toLowerCase());
    url.searchParams.set('ddate', route.departureDate);
    url.searchParams.set('triptype', isRoundTrip ? 'rt' : 'ow');
    url.searchParams.set('class', this.options.cabinClass);
    url.searchParams.set('quantity', String(this.options.passengers));
    url.searchParams.set('searchboxarg', 't');
    url.searchParams.set('curr', route.currency);

    if (isRoundTrip) {
      url.searchParams.set('rdate', route.returnDate);
    }

    return url.toString();
  }

  async searchLowestPrice(route) {
    let browser;
    let page;
    const searchUrl = this.buildSearchUrl(route);

    try {
      const launchOptions = {
        headless: this.options.headless
      };

      if (this.options.browserChannel) {
        launchOptions.channel = this.options.browserChannel;
      }

      browser = await chromium.launch(launchOptions);
      const context = await browser.newContext({
        locale: this.options.locale,
        timezoneId: config.scheduler.timezone,
        viewport: { width: 1440, height: 1000 },
        userAgent: this.options.userAgent,
        extraHTTPHeaders: {
          'Accept-Language': `${this.options.locale},en;q=0.9`
        }
      });

      page = await context.newPage();
      page.setDefaultTimeout(this.options.timeoutMs);

      const response = await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.options.timeoutMs
      });

      if (response && response.status() >= 400) {
        throw new Error(`Trip.com returned HTTP ${response.status()} for ${searchUrl}`);
      }

      await this.closeCookieOrPopupIfPresent(page);
      await this.throwIfKnownBlockPage(page);
      await this.waitForLikelyResults(page);
      await this.throwIfKnownBlockPage(page);
      const filterLog = await this.tryApplyPreferredFilters(page);

      const matchResult = await this.extractTargetFlightCombination(page, route.currency);
      if (!matchResult.match) {
        const outboundSelection = await this.trySelectTargetOutbound(page);
        if (outboundSelection.clicked) {
          await this.waitForLikelyResults(page);
          await this.tryApplyPreferredFilters(page);
          const returnMatch = await this.extractReturnAfterOutboundSelection(
            page,
            route.currency,
            outboundSelection.match
          );
          matchResult.match = returnMatch.match;
          matchResult.diagnostics.outboundSelection = outboundSelection;
          matchResult.diagnostics.returnAfterOutbound = returnMatch.diagnostics;
          if (returnMatch.match) {
            matchResult.diagnostics.failureReasons = [];
          }
        } else {
          matchResult.diagnostics.outboundSelection = outboundSelection;
        }
      }
      const pageArtifacts = await this.capturePageArtifacts(page, 'trip-page');
      let matchLogPath = await writeJsonLog('trip-match', {
        searchUrl,
        route,
        targetFlight: config.targetFlight,
        filterLog,
        matched: Boolean(matchResult.match),
        match: matchResult.match,
        diagnostics: matchResult.diagnostics,
        artifacts: pageArtifacts
      });

      if (!matchResult.match) {
        const error = new Error(
          [
            'Target round-trip flight combination was not found on Trip.com results page.',
            `Airlines read: ${matchResult.diagnostics.airlines.join(', ') || 'none'}.`,
            `Times read: ${matchResult.diagnostics.times.join(', ') || 'none'}.`,
            `Prices read: ${matchResult.diagnostics.prices.join(', ') || 'none'}.`,
            `Reason: ${matchResult.diagnostics.failureReasons.join('; ') || 'No candidate satisfied all matching rules'}.`
          ].join(' ')
        );
        error.tripDiagnostics = {
          ...matchResult.diagnostics,
          filterLog,
          screenshotPath: pageArtifacts.screenshotPath,
          htmlPath: pageArtifacts.htmlPath,
          matchLogPath
        };
        throw error;
      }

      const fareSelectionSteps = [];
      let finalPricePage = page;
      for (let step = 0; step < 2; step += 1) {
        const fareSelectionResult = await this.tryEnterFareSelectionPage(finalPricePage);
        finalPricePage = fareSelectionResult.page;
        fareSelectionSteps.push(fareSelectionResult.log);
        if (!fareSelectionResult.log.clicked) {
          break;
        }

        await this.waitForLikelyResults(finalPricePage);
        if (!/View Details|Details/i.test(fareSelectionResult.log.clickableText || '')) {
          break;
        }
      }
      matchResult.diagnostics.fareSelection = fareSelectionSteps;
      await this.closeCookieOrPopupIfPresent(finalPricePage);
      const finalPriceResult = await this.extractFinalPaymentPriceFromPage(finalPricePage, route.currency);
      matchResult.diagnostics.finalPriceSelection = finalPriceResult;
      if (finalPriceResult && finalPriceResult.selected) {
        matchResult.match.originalPrice = finalPriceResult.originalPrice || null;
        matchResult.match.originalPriceText = finalPriceResult.originalPriceText || '';
        matchResult.match.price = finalPriceResult.selected.price;
        matchResult.match.currency = finalPriceResult.selected.currency;
        matchResult.match.rawPriceText = finalPriceResult.selected.rawPriceText;
      }
      const finalPageArtifacts = finalPricePage === page
        ? pageArtifacts
        : await this.capturePageArtifacts(finalPricePage, 'trip-final-page');
      matchLogPath = await writeJsonLog('trip-final-price', {
        searchUrl,
        route,
        targetFlight: config.targetFlight,
        matched: true,
        match: matchResult.match,
        fareSelection: fareSelectionSteps,
        finalPriceSelection: finalPriceResult,
        artifacts: finalPageArtifacts
      });

      return {
        site: this.siteName,
        price: matchResult.match.price,
        currency: matchResult.match.currency,
        rawPriceText: matchResult.match.rawPriceText,
        originalPrice: matchResult.match.originalPrice,
        originalPriceText: matchResult.match.originalPriceText,
        url: searchUrl,
        outboundFlightNo: matchResult.match.outboundFlightNo,
        returnFlightNo: matchResult.match.returnFlightNo,
        airline: matchResult.match.airline,
        outboundAirline: matchResult.match.outboundAirline,
        returnAirline: matchResult.match.returnAirline,
        outboundTime: `${matchResult.match.outboundDepartureTime} → ${matchResult.match.outboundArrivalTime}`,
        returnTime: `${matchResult.match.returnDepartureTime} → ${matchResult.match.returnArrivalTime}`,
        outboundDepartureTime: matchResult.match.outboundDepartureTime,
        outboundArrivalTime: matchResult.match.outboundArrivalTime,
        returnDepartureTime: matchResult.match.returnDepartureTime,
        returnArrivalTime: matchResult.match.returnArrivalTime,
        isDirect: matchResult.match.isDirect,
        matchStatus: 'matched',
        screenshotPath: pageArtifacts.screenshotPath,
        htmlPath: pageArtifacts.htmlPath,
        matchLogPath
      };
    } catch (error) {
      const debug = await this.captureDebugArtifacts(page, error, searchUrl, route);
      if (error.tripDiagnostics) {
        error.tripDiagnostics.screenshotPath = debug.screenshotPath;
        error.tripDiagnostics.htmlPath = debug.htmlPath;
        error.tripDiagnostics.logPath = debug.logPath;
      }
      error.message = `${error.message}\nTrip.com debug artifacts: ${JSON.stringify(debug)}`;
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async closeCookieOrPopupIfPresent(page) {
    const possibleButtons = [
      'button:has-text("Accept")',
      'button:has-text("I Agree")',
      'button:has-text("Got it")',
      'button:has-text("OK")',
      '[aria-label="Close"]',
      '.close',
      '.c-close'
    ];

    for (const selector of possibleButtons) {
      const button = page.locator(selector).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  async waitForLikelyResults(page) {
    // 给前端应用一点时间完成渲染。即使网络空闲不可靠，也不要马上抽取。
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const priceLikeText = /(?:JPY|¥|USD|US\$|\$|EUR|€|GBP|£)\s*[0-9][0-9,.]*/i;

    await page
      .locator('body')
      .filter({ hasText: priceLikeText })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});
  }

  async tryApplyPreferredFilters(page) {
    const attempts = [];
    const filters = ['Direct', 'Nonstop', '直飞', 'Spring Airlines', '春秋航空'];

    for (const label of filters) {
      const locators = [
        page.getByText(label, { exact: true }).first(),
        page.getByText(label).first(),
        page.locator(`label:has-text("${label}")`).first(),
        page.locator(`button:has-text("${label}")`).first()
      ];

      let clicked = false;
      for (const locator of locators) {
        if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
          await locator.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1000);
          clicked = true;
          break;
        }
      }

      attempts.push({ label, clicked });
    }

    return attempts;
  }

  async throwIfKnownBlockPage(page) {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const normalized = bodyText.replace(/\s+/g, ' ').trim().toLowerCase();

    if (!normalized) {
      return;
    }

    if (normalized.includes('whaleguard block')) {
      throw new Error(
        [
          'Trip.com returned a WhaleGuard block page, so no real price can be read.',
          'Try running with HEADLESS=false, or PLAYWRIGHT_CHANNEL=chrome if local Chrome is installed.',
          'The scraper intentionally does not fabricate a price when Trip.com blocks the page.'
        ].join(' ')
      );
    }

    if (normalized.includes('access denied') || normalized.includes('verify you are human')) {
      throw new Error(
        `Trip.com returned an access/verification page instead of flight results. Page text: ${bodyText.slice(0, 300)}`
      );
    }
  }

  async extractLowestPriceFromPage(page, preferredCurrency) {
    const candidates = await page.evaluate((currency) => {
      const visibleTextNodes = [];

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      const elements = Array.from(document.querySelectorAll('body *'));
      for (const element of elements) {
        if (!isVisible(element)) {
          continue;
        }

        const text = (element.innerText || element.textContent || '').trim();
        if (!text || text.length > 160) {
          continue;
        }

        if (/JPY|¥|USD|US\$|\$|EUR|€|GBP|£|円/i.test(text)) {
          visibleTextNodes.push(text);
        }
      }

      const bodyText = document.body ? document.body.innerText : '';
      const allText = visibleTextNodes.concat(bodyText);

      function normalizeAmount(value) {
        const normalized = value.replace(/,/g, '');
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? Math.round(number) : null;
      }

      function minimumReasonablePrice(detectedCurrency) {
        if (detectedCurrency === 'JPY') {
          return 1000;
        }

        return 10;
      }

      function addMatch(results, rawText, amount, detectedCurrency) {
        const price = normalizeAmount(amount);

        // 太小的数字大概率是评分、日期、人数等，不作为机票候选价格。
        if (!price || price < minimumReasonablePrice(detectedCurrency)) {
          return;
        }

        results.push({
          price,
          currency: detectedCurrency,
          rawText: rawText.replace(/\s+/g, ' ').trim()
        });
      }

      const results = [];
      const escapedCurrency = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const preferredPatterns = [
        new RegExp(`(?:${escapedCurrency}|¥)\\s*([0-9][0-9,.]*)`, 'gi'),
        new RegExp(`([0-9][0-9,.]*)\\s*(?:${escapedCurrency}|円)`, 'gi')
      ];
      const genericPatterns = [
        /(?:USD|US\$|\$)\s*([0-9][0-9,.]*)/gi,
        /(?:JPY|¥)\s*([0-9][0-9,.]*)/gi,
        /([0-9][0-9,.]*)\s*(?:JPY|円)/gi,
        /(?:EUR|€)\s*([0-9][0-9,.]*)/gi,
        /(?:GBP|£)\s*([0-9][0-9,.]*)/gi
      ];

      for (const text of allText) {
        for (const pattern of preferredPatterns) {
          let match;
          while ((match = pattern.exec(text))) {
            addMatch(results, match[0], match[1], currency);
          }
        }

        for (const pattern of genericPatterns) {
          let match;
          while ((match = pattern.exec(text))) {
            const raw = match[0];
            const detectedCurrency = raw.includes('¥') || /JPY|円/i.test(raw)
              ? 'JPY'
              : raw.includes('€') || /EUR/i.test(raw)
                ? 'EUR'
                : raw.includes('£') || /GBP/i.test(raw)
                  ? 'GBP'
                  : 'USD';

            addMatch(results, raw, match[1], detectedCurrency);
          }
        }
      }

      return results;
    }, preferredCurrency);

    const preferred = candidates.filter((candidate) => candidate.currency === preferredCurrency);
    const usable = preferred.length > 0 ? preferred : candidates;

    if (usable.length === 0) {
      return null;
    }

    usable.sort((a, b) => a.price - b.price);
    return usable[0];
  }

  async extractFinalPaymentPriceFromPage(page, preferredCurrency) {
    return page.evaluate((currency) => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function normalizeAmount(value) {
        const normalized = value.replace(/,/g, '');
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? Math.round(number) : null;
      }

      function detectCurrency(rawText) {
        if (/JPY|円|¥/i.test(rawText)) {
          return 'JPY';
        }
        if (/EUR|€/i.test(rawText)) {
          return 'EUR';
        }
        if (/GBP|£/i.test(rawText)) {
          return 'GBP';
        }
        if (/USD|US\$|\$/i.test(rawText)) {
          return 'USD';
        }
        return currency;
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0;
      }

      function hasLineThrough(element) {
        let current = element;
        for (let depth = 0; current && depth < 4; depth += 1) {
          const style = window.getComputedStyle(current);
          if (/line-through/i.test(style.textDecorationLine || style.textDecoration || '')) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      }

      function extractPrices(text) {
        const escapedCurrency = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          new RegExp(`(?:${escapedCurrency}|JPY|¥)\\s*([0-9][0-9,.]*)`, 'gi'),
          new RegExp(`([0-9][0-9,.]*)\\s*(?:${escapedCurrency}|JPY|円)`, 'gi'),
          /(?:USD|US\$|\$)\s*([0-9][0-9,.]*)/gi,
          /(?:EUR|€)\s*([0-9][0-9,.]*)/gi,
          /(?:GBP|£)\s*([0-9][0-9,.]*)/gi
        ];

        const prices = [];
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(text))) {
            const price = normalizeAmount(match[1]);
            if (!price || price < 1000) {
              continue;
            }

            prices.push({
              price,
              currency: detectCurrency(match[0]),
              rawPriceText: clean(match[0]),
              index: match.index
            });
          }
        }

        return prices;
      }

      function keywordScore(text) {
        let score = 0;
        if (/total|payment|pay now|pay|amount|current|final|price|subtotal|合計|总计|總計|支付|付款|价格|價格|当前|目前|最终|最終|料金|支払|お支払い/i.test(text)) {
          score += 4;
        }
        if (/coupon|discount|off|优惠|割引|値引|クーポン/i.test(text)) {
          score += 1;
        }
        if (/tax|fee|fare|taxes|手数料|税/i.test(text)) {
          score += 1;
        }
        if (/original|was|list price|参考|原价|原價|通常|割引前/i.test(text)) {
          score -= 2;
        }
        return score;
      }

      function hasPaymentKeyword(text) {
        return /total|payment|pay now|pay|amount due|current|final|subtotal|book|continue|next|合計|总计|總計|支付|付款|当前|目前|最终|最終|支払|お支払い|予約|次へ|続行/i.test(text);
      }

      function isPriceAlertText(text) {
        return /price alerts?|want a better deal|notify you when the price drops|recommended:|high chances of success|低价提醒|降价提醒|价格提醒|価格アラート/i.test(text);
      }

      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const elements = Array.from(document.querySelectorAll('body *'));
      const candidates = [];

      for (const element of elements) {
        if (!isVisible(element)) {
          continue;
        }

        const text = clean(element.innerText || element.textContent || '');
        if (!text || text.length > 1200 || !/(JPY|¥|円|USD|US\$|\$|EUR|€|GBP|£)/i.test(text)) {
          continue;
        }

        if (isPriceAlertText(text)) {
          continue;
        }

        const prices = extractPrices(text);
        if (prices.length === 0) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const fixedOrSticky = style.position === 'fixed' || style.position === 'sticky';
        const bottomZone = rect.top >= viewportHeight * 0.55 || rect.bottom >= viewportHeight * 0.78;
        const rightZone = rect.left >= viewportWidth * 0.45 || rect.right >= viewportWidth * 0.78;
        const lineThrough = hasLineThrough(element);
        const semanticScore = keywordScore(text);
        const paymentKeyword = hasPaymentKeyword(text);

        prices.forEach((priceItem, priceIndex) => {
          const score =
            (fixedOrSticky ? 100 : 0) +
            (bottomZone ? 45 : 0) +
            (rightZone ? 25 : 0) +
            semanticScore +
            (lineThrough ? -80 : 0) +
            (priceIndex === prices.length - 1 ? 8 : 0);

          candidates.push({
            ...priceItem,
            elementText: text.slice(0, 500),
            fixedOrSticky,
            bottomZone,
            rightZone,
            lineThrough,
            paymentKeyword,
            score,
            rect: {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              bottom: Math.round(rect.bottom),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          });
        });
      }

      const preferredCurrencyCandidates = candidates.filter((candidate) => candidate.currency === currency);
      const usable = preferredCurrencyCandidates.length > 0 ? preferredCurrencyCandidates : candidates;
      const finalAreaCandidates = usable.filter((candidate) =>
        (candidate.fixedOrSticky && (candidate.bottomZone || candidate.rightZone)) ||
        (candidate.bottomZone && candidate.rightZone && candidate.paymentKeyword)
      );
      const finalPool = finalAreaCandidates;

      const selected = finalPool
        .slice()
        .sort((a, b) =>
          b.score - a.score ||
          Number(a.lineThrough) - Number(b.lineThrough) ||
          a.price - b.price ||
          b.index - a.index
        )[0] || null;

      const possibleOriginal = usable
        .filter((candidate) =>
          selected &&
          candidate.currency === selected.currency &&
          candidate.price > selected.price &&
          (candidate.lineThrough || /original|was|参考|原价|原價|通常|割引前/i.test(candidate.elementText))
        )
        .sort((a, b) => a.price - b.price)[0] || null;

      return {
        selected,
        originalPrice: possibleOriginal ? possibleOriginal.price : null,
        originalPriceText: possibleOriginal ? possibleOriginal.rawPriceText : '',
        candidates: usable
          .slice()
          .sort((a, b) => b.score - a.score || a.price - b.price)
          .slice(0, 80),
        selectionReason: selected
          ? [
              selected.fixedOrSticky ? '优先选择 fixed/sticky 底部固定栏候选' : '未识别到固定栏，使用页面可见候选',
              selected.bottomZone ? '候选位于页面下方区域' : '候选不在下方区域',
              selected.rightZone ? '候选位于右侧区域' : '候选不在右侧区域',
              selected.lineThrough ? '候选疑似划线价，因缺少更好候选才选择' : '候选不是划线价',
              '如同一区域出现多个价格，优先当前支付/最终价语义并避开原价；分数相近时选择较低的优惠后价格'
            ].join('；')
          : '未读取到可用价格候选'
      };
    }, preferredCurrency);
  }

  async tryEnterFareSelectionPage(page) {
    const selection = await page.evaluate((target) => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function uniqueElements(values) {
        return Array.from(new Set(values.filter(Boolean)));
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }

      function parseMinutes(value) {
        const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
      }

      function withinTolerance(actual, expected) {
        const actualMinutes = parseMinutes(actual);
        const expectedMinutes = parseMinutes(expected);
        return actualMinutes !== null &&
          expectedMinutes !== null &&
          Math.abs(actualMinutes - expectedMinutes) <= target.timeToleranceMinutes;
      }

      function hasAny(text, keywords) {
        const lower = text.toLowerCase();
        return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
      }

      function hasDirect(text) {
        return !target.directOnly || (/(?:^|\b)(Nonstop|Direct)(?:\b|$)|直飞/i.test(text) && !hasAny(text, target.forbiddenStopKeywords));
      }

      function hasTargetTime(text, expected) {
        const times = Array.from(new Set(text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []));
        return times.some((time) => withinTolerance(time, expected));
      }

      function clickableText(node) {
        return clean(node.innerText || node.textContent || '');
      }

      function findClickable(container) {
        const clickables = Array.from(container.querySelectorAll('button, a, [role="button"]'))
          .filter((node) => /View Details|Details|Select|Book|Continue|Next|选择|選択|预订|預訂|予約|继续|下一步|次へ/i.test(clickableText(node)));

        return clickables
          .sort((a, b) => {
            function priority(node) {
              const text = clickableText(node);
              if (/Select|Book|Continue|Next|选择|選択|预订|預訂|予約|继续|下一步|次へ/i.test(text)) {
                return 0;
              }
              return 1;
            }

            return priority(a) - priority(b);
          })[0];
      }

      function findSelectableContainer(element) {
        let current = element;
        for (let depth = 0; current && depth < 8; depth += 1) {
          const text = clean(current.innerText || current.textContent || '');
          if (text.length > 0 && text.length < 2200 && findClickable(current)) {
            return current;
          }
          current = current.parentElement;
        }
        return element;
      }

      const selectors = ['[class*="flight" i]', '[class*="card" i]', '[class*="result" i]', 'li', 'section', 'article', 'div'];
      const elements = uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
      const candidates = elements
        .filter(isVisible)
        .map((element) => {
          const text = clean(element.innerText || element.textContent || '');
          const container = findSelectableContainer(element);
          const containerText = clean(container.innerText || container.textContent || '');
          const clickable = findClickable(container);
          const returnDeparture = hasTargetTime(text, target.return.departureTime);
          const returnArrival = hasTargetTime(text, target.return.arrivalTime);
          const outboundDeparture = hasTargetTime(text, target.outbound.departureTime);
          const outboundArrival = hasTargetTime(text, target.outbound.arrivalTime);

          return {
            element: container,
            text,
            containerText,
            hasAirline: hasAny(text, target.airlineKeywords),
            hasDirect: hasDirect(text),
            returnDeparture,
            returnArrival,
            outboundDeparture,
            outboundArrival,
            hasClickable: Boolean(clickable),
            clickableText: clickable ? clickableText(clickable) : '',
            score: [
              hasAny(text, target.airlineKeywords),
              hasDirect(text),
              returnDeparture,
              returnArrival,
              Boolean(clickable)
            ].filter(Boolean).length
          };
        })
        .filter((candidate) =>
          candidate.text.length >= 20 &&
          candidate.text.length <= 4000 &&
          candidate.containerText.length <= 2200 &&
          candidate.hasAirline &&
          candidate.hasDirect &&
          candidate.returnDeparture &&
          candidate.returnArrival &&
          candidate.hasClickable
        )
        .sort((a, b) =>
          a.containerText.length - b.containerText.length ||
          b.score - a.score
        );

      const best = candidates[0];
      document.querySelectorAll('[data-codex-target-fare]').forEach((element) => {
        element.removeAttribute('data-codex-target-fare');
      });
      document.querySelectorAll('[data-codex-target-fare-button]').forEach((element) => {
        element.removeAttribute('data-codex-target-fare-button');
      });

      if (!best) {
        return {
          found: false,
          clicked: false,
          reason: 'No target return/combination card with a fare-selection button was found.'
        };
      }

      best.element.setAttribute('data-codex-target-fare', 'true');
      const button = findClickable(best.element);
      if (button) {
        button.setAttribute('data-codex-target-fare-button', 'true');
      }
      return {
        found: true,
        clicked: false,
        clickableText: best.clickableText,
        textPreview: best.containerText.slice(0, 700)
      };
    }, config.targetFlight);

    if (!selection.found) {
      return { log: selection, page };
    }

    const targetCard = page.locator('[data-codex-target-fare="true"]').first();
    const button = page.locator('[data-codex-target-fare-button="true"]').first();

    if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
      const popupPromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
      await button.click({ timeout: 5000 }).catch(() => {});
      const popup = await popupPromise;
      const activePage = popup || page;
      await activePage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await activePage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await activePage.waitForTimeout(5000);
      return {
        log: {
          ...selection,
          clicked: true,
          openedNewPage: Boolean(popup),
          urlAfterClick: activePage.url()
        },
        page: activePage
      };
    }

    const popupPromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await targetCard.click({ timeout: 5000 }).catch(() => {});
    const popup = await popupPromise;
    const activePage = popup || page;
    await activePage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await activePage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await activePage.waitForTimeout(5000);
    return {
      log: {
        ...selection,
        clicked: true,
        clickedCard: true,
        openedNewPage: Boolean(popup),
        urlAfterClick: activePage.url()
      },
      page: activePage
    };
  }

  async extractTargetFlightCombination(page, preferredCurrency) {
    return page.evaluate(({ currency, target }) => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function unique(values) {
        return Array.from(new Set(values.map(clean).filter(Boolean)));
      }

      function uniqueElements(values) {
        return Array.from(new Set(values.filter(Boolean)));
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      function normalizeAmount(value) {
        const normalized = value.replace(/,/g, '');
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? Math.round(number) : null;
      }

      function detectCurrency(rawText) {
        if (/JPY|円|¥/i.test(rawText)) {
          return 'JPY';
        }
        if (/EUR|€/i.test(rawText)) {
          return 'EUR';
        }
        if (/GBP|£/i.test(rawText)) {
          return 'GBP';
        }
        if (/USD|US\$|\$/i.test(rawText)) {
          return 'USD';
        }
        return currency;
      }

      function extractPrice(text) {
        const escapedCurrency = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
          new RegExp(`(?:${escapedCurrency}|JPY|¥)\\s*([0-9][0-9,.]*)`, 'i'),
          new RegExp(`([0-9][0-9,.]*)\\s*(?:${escapedCurrency}|JPY|円)`, 'i'),
          /(?:USD|US\$|\$)\s*([0-9][0-9,.]*)/i,
          /(?:EUR|€)\s*([0-9][0-9,.]*)/i,
          /(?:GBP|£)\s*([0-9][0-9,.]*)/i
        ];

        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (!match) {
            continue;
          }

          const price = normalizeAmount(match[1]);
          if (price) {
            return {
              price,
              currency: detectCurrency(match[0]),
              rawPriceText: clean(match[0])
            };
          }
        }

        return null;
      }

      function hasAny(text, keywords) {
        const lower = text.toLowerCase();
        return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
      }

      function parseMinutes(value) {
        const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        if (!match) {
          return null;
        }

        return Number(match[1]) * 60 + Number(match[2]);
      }

      function withinTolerance(actual, expected) {
        const actualMinutes = parseMinutes(actual);
        const expectedMinutes = parseMinutes(expected);
        if (actualMinutes === null || expectedMinutes === null) {
          return false;
        }

        return Math.abs(actualMinutes - expectedMinutes) <= target.timeToleranceMinutes;
      }

      function findMatchingTime(times, expected) {
        return times.find((time) => withinTolerance(time, expected)) || '';
      }

      function matchTimes(text) {
        const times = unique(text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []);
        const outboundDeparture = findMatchingTime(times, target.outbound.departureTime);
        const outboundArrival = findMatchingTime(times, target.outbound.arrivalTime);
        const returnDeparture = findMatchingTime(times, target.return.departureTime);
        const returnArrival = findMatchingTime(times, target.return.arrivalTime);

        return {
          times,
          outboundDeparture,
          outboundArrival,
          returnDeparture,
          returnArrival,
          matched: Boolean(outboundDeparture && outboundArrival && returnDeparture && returnArrival)
        };
      }

      function isDirectText(text) {
        if (!target.directOnly) {
          return true;
        }

        return /(?:^|\b)(Nonstop|Direct)(?:\b|$)|直飞/i.test(text) && !hasAny(text, target.forbiddenStopKeywords);
      }

      function findAirline(text) {
        if (/春秋航空/.test(text)) {
          return '春秋航空';
        }
        if (/Spring Airlines/i.test(text)) {
          return 'Spring Airlines';
        }
        return '';
      }

      function extractFlightNumbers(text) {
        return unique(text.match(/\b[A-Z0-9]{2}\s?\d{3,4}\b/g) || [])
          .map((value) => value.replace(/\s+/g, ''));
      }

      const bodyText = clean(document.body ? document.body.innerText : '');
      const flightNumbers = extractFlightNumbers(bodyText);
      const airlines = unique(
        []
          .concat(bodyText.match(/春秋航空/g) || [])
          .concat(bodyText.match(/Spring Airlines/gi) || [])
          .concat(bodyText.match(/[A-Z][A-Za-z ]+ Airlines/g) || [])
      );
      const times = unique(bodyText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []);
      const prices = unique(
        []
          .concat(bodyText.match(/(?:JPY|¥)\s*[0-9][0-9,.]*/gi) || [])
          .concat(bodyText.match(/[0-9][0-9,.]*\s*(?:JPY|円)/gi) || [])
          .concat(bodyText.match(/(?:USD|US\$|\$)\s*[0-9][0-9,.]*/gi) || [])
      );

      const selectors = [
        '[class*="flight" i]',
        '[class*="card" i]',
        '[class*="result" i]',
        '[class*="list" i]',
        '[data-testid*="flight" i]',
        'li',
        'section',
        'article',
        'div'
      ];
      const elements = uniqueElements(
        selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      );
      const cards = elements
        .filter((element) => isVisible(element))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: clean(element.innerText || element.textContent || ''),
            area: Math.round(rect.width * rect.height)
          };
        })
        .filter((card) => {
          if (!card.text || card.text.length < 20 || card.text.length > 6000) {
            return false;
          }

          return /春秋航空|Spring Airlines|18:00|19:00|13:50|13:55|17:00|JPY|¥|USD|US\$|\$/i.test(card.text);
        });

      // 如果 Trip 把往返组合渲染在一个大容器里，这里会命中最小的完整容器。
      const candidates = cards.concat([{ text: bodyText, area: Number.MAX_SAFE_INTEGER }])
        .map((card) => {
          const price = extractPrice(card.text);
          const airline = findAirline(card.text);
          const hasAirline = Boolean(airline) || hasAny(card.text, target.airlineKeywords);
          const timeMatch = matchTimes(card.text);
          const isDirect = isDirectText(card.text);
          const cardFlightNumbers = extractFlightNumbers(card.text);

          return {
            ...card,
            price,
            flightNumbers: cardFlightNumbers,
            airline: airline || target.airlineKeywords[0],
            hasAirline,
            timeMatch,
            hasTimes: timeMatch.matched,
            isDirect,
            score: [
              hasAirline,
              timeMatch.matched,
              isDirect,
              Boolean(price)
            ].filter(Boolean).length
          };
        })
        .filter((candidate) =>
          candidate.price &&
          candidate.hasAirline &&
          candidate.hasTimes &&
          candidate.isDirect
        )
        .sort((a, b) => a.area - b.area || a.text.length - b.text.length);

      const bestCandidate = candidates[0] || null;

      return {
        match: bestCandidate
          ? {
              price: bestCandidate.price.price,
              currency: bestCandidate.price.currency,
              rawPriceText: bestCandidate.price.rawPriceText,
              outboundFlightNo: bestCandidate.flightNumbers[0] || '',
              returnFlightNo: bestCandidate.flightNumbers[1] || '',
              airline: bestCandidate.airline,
              outboundAirline: bestCandidate.airline,
              returnAirline: bestCandidate.airline,
              outboundDepartureTime: bestCandidate.timeMatch.outboundDeparture,
              outboundArrivalTime: bestCandidate.timeMatch.outboundArrival,
              returnDepartureTime: bestCandidate.timeMatch.returnDeparture,
              returnArrivalTime: bestCandidate.timeMatch.returnArrival,
              isDirect: true
            }
          : null,
        diagnostics: {
          flightNumbers,
          airlines,
          times,
          prices,
          candidateCount: cards.length,
          failureReasons: candidates.length > 0
            ? []
            : [
                'No visible candidate satisfied airline + direct + outbound/return time tolerance + price rules.'
              ],
          bestPartialMatches: cards
            .map((card) => {
              const price = extractPrice(card.text);
              const timeMatch = matchTimes(card.text);
              return {
                textPreview: card.text.slice(0, 500),
                hasAirline: hasAny(card.text, target.airlineKeywords),
                matchedTimes: {
                  outboundDeparture: timeMatch.outboundDeparture,
                  outboundArrival: timeMatch.outboundArrival,
                  returnDeparture: timeMatch.returnDeparture,
                  returnArrival: timeMatch.returnArrival
                },
                hasTargetTimes: timeMatch.matched,
                isDirect: isDirectText(card.text),
                rawPriceText: price ? price.rawPriceText : ''
              };
            })
            .filter((item) => item.hasAirline || item.hasTargetTimes || item.rawPriceText)
            .slice(0, 20)
        }
      };
    }, { currency: preferredCurrency, target: config.targetFlight });
  }

  async trySelectTargetOutbound(page) {
    const selection = await page.evaluate((target) => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function uniqueElements(values) {
        return Array.from(new Set(values.filter(Boolean)));
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }

      function parseMinutes(value) {
        const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
      }

      function withinTolerance(actual, expected) {
        const actualMinutes = parseMinutes(actual);
        const expectedMinutes = parseMinutes(expected);
        return actualMinutes !== null &&
          expectedMinutes !== null &&
          Math.abs(actualMinutes - expectedMinutes) <= target.timeToleranceMinutes;
      }

      function hasAny(text, keywords) {
        const lower = text.toLowerCase();
        return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
      }

      function extractFlightNumbers(text) {
        return Array.from(new Set((text.match(/\b[A-Z0-9]{2}\s?\d{3,4}\b/g) || []).map((value) => value.replace(/\s+/g, ''))));
      }

      function findSelectableContainer(element) {
        let current = element;
        for (let depth = 0; current && depth < 8; depth += 1) {
          const button = Array.from(current.querySelectorAll('button, a, [role="button"]'))
            .find((node) => /Select|选择|選択|Book/i.test(clean(node.innerText || node.textContent || '')));
          const text = clean(current.innerText || current.textContent || '');
          if (button && text.length < 5000) {
            return current;
          }
          current = current.parentElement;
        }

        return element;
      }

      function findAirline(text) {
        if (/春秋航空/.test(text)) {
          return '春秋航空';
        }
        if (/Spring Airlines/i.test(text)) {
          return 'Spring Airlines';
        }
        return target.airline;
      }

      const selectors = ['[class*="flight" i]', '[class*="card" i]', '[class*="result" i]', 'li', 'section', 'article', 'div'];
      const elements = uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
      const candidates = elements
        .filter(isVisible)
        .map((element) => {
          const text = clean(element.innerText || element.textContent || '');
          const times = Array.from(new Set(text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []));
          const hasAirline = hasAny(text, target.airlineKeywords);
          const hasDirect = !target.directOnly || (/(?:^|\b)(Nonstop|Direct)(?:\b|$)|直飞/i.test(text) && !hasAny(text, target.forbiddenStopKeywords));
          const hasOutboundDeparture = times.some((time) => withinTolerance(time, target.outbound.departureTime));
          const hasOutboundArrival = times.some((time) => withinTolerance(time, target.outbound.arrivalTime));
          const selectableContainer = findSelectableContainer(element);
          const button = Array.from(selectableContainer.querySelectorAll('button, a, [role="button"]'))
            .find((node) => /Select|选择|選択|Book/i.test(clean(node.innerText || node.textContent || '')));

          return {
            element: selectableContainer,
            text,
            containerText: clean(selectableContainer.innerText || selectableContainer.textContent || ''),
            hasAirline,
            hasDirect,
            hasOutboundDeparture,
            hasOutboundArrival,
            buttonText: button ? clean(button.innerText || button.textContent || '') : '',
            flightNumbers: extractFlightNumbers(text),
            airline: findAirline(text)
          };
        })
        .filter((candidate) =>
          candidate.text.length >= 20 &&
          candidate.text.length <= 3000 &&
          candidate.hasAirline &&
          candidate.hasDirect &&
          candidate.hasOutboundDeparture &&
          candidate.hasOutboundArrival
        )
        .sort((a, b) => a.text.length - b.text.length);

      const best = candidates[0];
      if (!best) {
        return {
          found: false,
          clicked: false,
          reason: 'No outbound card matched airline + direct + outbound time tolerance.'
        };
      }

      document.querySelectorAll('[data-codex-target-outbound]').forEach((element) => {
        element.removeAttribute('data-codex-target-outbound');
      });
      best.element.setAttribute('data-codex-target-outbound', 'true');

      return {
        found: true,
        clicked: false,
        match: {
          outboundFlightNo: best.flightNumbers[0] || '',
          outboundAirline: best.airline,
          outboundDepartureTime: target.outbound.departureTime,
          outboundArrivalTime: target.outbound.arrivalTime,
          textPreview: best.containerText.slice(0, 500)
        }
      };
    }, config.targetFlight);

    if (!selection.found) {
      return selection;
    }

    const targetCard = page.locator('[data-codex-target-outbound="true"]').first();
    const button = targetCard
      .locator('button:has-text("Select"), a:has-text("Select"), [role="button"]:has-text("Select"), button:has-text("选择"), a:has-text("选择")')
      .first();

    if (await button.isVisible({ timeout: 3000 }).catch(() => false)) {
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(5000);
      return { ...selection, clicked: true };
    }

    await targetCard.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(5000);
    return { ...selection, clicked: true, clickedCard: true };
  }

  async extractReturnAfterOutboundSelection(page, preferredCurrency, outboundMatch) {
    return page.evaluate(({ currency, target, outbound }) => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function unique(values) {
        return Array.from(new Set(values.map(clean).filter(Boolean)));
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }

      function parseMinutes(value) {
        const match = String(value || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
      }

      function withinTolerance(actual, expected) {
        const actualMinutes = parseMinutes(actual);
        const expectedMinutes = parseMinutes(expected);
        return actualMinutes !== null &&
          expectedMinutes !== null &&
          Math.abs(actualMinutes - expectedMinutes) <= target.timeToleranceMinutes;
      }

      function hasAny(text, keywords) {
        const lower = text.toLowerCase();
        return keywords.some((keyword) => lower.includes(String(keyword).toLowerCase()));
      }

      function normalizeAmount(value) {
        const normalized = value.replace(/,/g, '');
        const number = Number.parseFloat(normalized);
        return Number.isFinite(number) ? Math.round(number) : null;
      }

      function extractPrice(text) {
        const patterns = [
          /(?:JPY|¥)\s*([0-9][0-9,.]*)/i,
          /([0-9][0-9,.]*)\s*(?:JPY|円)/i,
          /(?:USD|US\$|\$)\s*([0-9][0-9,.]*)/i
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            const price = normalizeAmount(match[1]);
            if (price) {
              return { price, currency: /USD|US\$|\$/i.test(match[0]) ? 'USD' : currency, rawPriceText: clean(match[0]) };
            }
          }
        }
        return null;
      }

      function extractFlightNumbers(text) {
        return unique(text.match(/\b[A-Z0-9]{2}\s?\d{3,4}\b/g) || []).map((value) => value.replace(/\s+/g, ''));
      }

      const bodyText = clean(document.body ? document.body.innerText : '');
      const selectors = ['[class*="flight" i]', '[class*="card" i]', '[class*="result" i]', 'li', 'section', 'article', 'div'];
      const elements = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
      const cards = elements
        .filter(isVisible)
        .map((element) => clean(element.innerText || element.textContent || ''))
        .filter((text) => text.length >= 20 && text.length <= 4000);

      const allTexts = cards.concat([bodyText]);
      const candidates = allTexts
        .map((text) => {
          const times = unique(text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []);
          const hasAirline = hasAny(text, target.airlineKeywords);
          const hasDirect = !target.directOnly || (/(?:^|\b)(Nonstop|Direct)(?:\b|$)|直飞/i.test(text) && !hasAny(text, target.forbiddenStopKeywords));
          const returnDeparture = times.find((time) => withinTolerance(time, target.return.departureTime)) || '';
          const returnArrival = times.find((time) => withinTolerance(time, target.return.arrivalTime)) || '';
          const price = extractPrice(text);

          return {
            text,
            hasAirline,
            hasDirect,
            returnDeparture,
            returnArrival,
            price,
            flightNumbers: extractFlightNumbers(text)
          };
        })
        .filter((candidate) =>
          candidate.hasAirline &&
          candidate.hasDirect &&
          candidate.returnDeparture &&
          candidate.returnArrival &&
          candidate.price
        )
        .sort((a, b) => a.text.length - b.text.length);

      const best = candidates[0];
      const airlines = unique(
        []
          .concat(bodyText.match(/春秋航空/g) || [])
          .concat(bodyText.match(/Spring Airlines/gi) || [])
          .concat(bodyText.match(/[A-Z][A-Za-z ]+ Airlines/g) || [])
      );
      const times = unique(bodyText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []);
      const prices = unique(
        []
          .concat(bodyText.match(/(?:JPY|¥)\s*[0-9][0-9,.]*/gi) || [])
          .concat(bodyText.match(/[0-9][0-9,.]*\s*(?:JPY|円)/gi) || [])
          .concat(bodyText.match(/(?:USD|US\$|\$)\s*[0-9][0-9,.]*/gi) || [])
      );

      return {
        match: best
          ? {
              price: best.price.price,
              currency: best.price.currency,
              rawPriceText: best.price.rawPriceText,
              outboundFlightNo: outbound.outboundFlightNo || '',
              returnFlightNo: best.flightNumbers[0] || '',
              airline: target.airline,
              outboundAirline: outbound.outboundAirline || target.airline,
              returnAirline: target.airline,
              outboundDepartureTime: outbound.outboundDepartureTime || target.outbound.departureTime,
              outboundArrivalTime: outbound.outboundArrivalTime || target.outbound.arrivalTime,
              returnDepartureTime: best.returnDeparture,
              returnArrivalTime: best.returnArrival,
              isDirect: true
            }
          : null,
        diagnostics: {
          airlines,
          times,
          prices,
          returnCandidateCount: cards.length,
          bestPartialMatches: candidates.slice(0, 10).map((candidate) => ({
            textPreview: candidate.text.slice(0, 500),
            returnDeparture: candidate.returnDeparture,
            returnArrival: candidate.returnArrival,
            rawPriceText: candidate.price ? candidate.price.rawPriceText : ''
          })),
          failureReasons: best ? [] : ['No return card matched airline + direct + return time tolerance + price rules after selecting outbound.']
        }
      };
    }, { currency: preferredCurrency, target: config.targetFlight, outbound: outboundMatch || {} });
  }

  async extractFlightDetailsFromPage(page) {
    return page.evaluate(() => {
      function clean(value) {
        return value ? value.replace(/\s+/g, ' ').trim() : '';
      }

      function unique(values) {
        return Array.from(new Set(values.map(clean).filter(Boolean)));
      }

      function findAirline(text) {
        const airlinePatterns = [
          /春秋航空/g,
          /Spring Airlines/gi,
          /China Eastern/gi,
          /中国东方航空/g,
          /Shanghai Airlines/gi,
          /上海航空/g,
          /Japan Airlines/gi,
          /日本航空/g,
          /All Nippon Airways/gi,
          /全日空/g,
          /Peach Aviation/gi,
          /Peach/gi,
          /Jetstar/gi
        ];

        for (const pattern of airlinePatterns) {
          const match = text.match(pattern);
          if (match && match[0]) {
            const value = clean(match[0]);
            return /^Spring Airlines$/i.test(value) ? '春秋航空' : value;
          }
        }

        return '';
      }

      const bodyText = clean(document.body ? document.body.innerText : '');
      const flightNumbers = unique(bodyText.match(/\b[A-Z0-9]{2}\s?\d{3,4}\b/g) || [])
        .map((value) => value.replace(/\s+/g, ''));

      const segmentTexts = flightNumbers.map((flightNo) => {
        const compactFlightNo = flightNo.replace(/\s+/g, '');
        const index = bodyText.replace(/\s+/g, '').indexOf(compactFlightNo);
        if (index === -1) {
          return bodyText;
        }

        return bodyText.slice(Math.max(0, index - 260), index + 360);
      });

      const timesBySegment = segmentTexts.map((segment) => unique(segment.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []));

      function formatTimeRange(times) {
        if (times.length >= 2) {
          return `${times[0]} → ${times[1]}`;
        }

        return times[0] || '';
      }

      const airline = segmentTexts.map(findAirline).find(Boolean) || findAirline(bodyText);

      return {
        outboundFlightNo: flightNumbers[0] || '',
        returnFlightNo: flightNumbers[1] || '',
        airline,
        outboundTime: formatTimeRange(timesBySegment[0] || []),
        returnTime: formatTimeRange(timesBySegment[1] || [])
      };
    });
  }

  async captureDebugArtifacts(page, error, searchUrl, route) {
    await ensureLogDirs();

    const debug = {
      searchUrl,
      route,
      errorMessage: error.message,
      tripDiagnostics: error.tripDiagnostics || null,
      screenshotPath: null,
      htmlPath: null,
      logPath: null
    };

    if (page) {
      const name = `trip-${timestampForFile()}`;
      const screenshotPath = path.join(config.logging.screenshotDir, `${name}.png`);

      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      debug.screenshotPath = screenshotPath;

      const html = await page.content().catch(() => '');
      if (html) {
        debug.htmlPath = await writeDebugHtml('trip-page', html);
      }

      debug.pageTitle = await page.title().catch(() => '');
      debug.bodyPreview = await page
        .locator('body')
        .innerText({ timeout: 3000 })
        .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 500))
        .catch(() => '');
    }

    debug.logPath = await writeJsonLog('trip-error', {
      ...debug,
      stack: error.stack
    });

    return debug;
  }

  async capturePageArtifacts(page, namePrefix) {
    await ensureLogDirs();

    const name = `${namePrefix}-${timestampForFile()}`;
    const screenshotPath = path.join(config.logging.screenshotDir, `${name}.png`);
    const artifacts = {
      screenshotPath: null,
      htmlPath: null
    };

    if (!page) {
      return artifacts;
    }

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    artifacts.screenshotPath = screenshotPath;

    const html = await page.content().catch(() => '');
    if (html) {
      artifacts.htmlPath = await writeDebugHtml(namePrefix, html);
    }

    return artifacts;
  }
}

module.exports = TripScraper;
