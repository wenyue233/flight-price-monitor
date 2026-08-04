/**
 * 航空券価格 scraper が実装する共通インターフェースを定義する基底クラス。
 */

class BaseScraper {
  constructor(options = {}) {
    if (!options.siteName) {
      throw new Error('Scraper must define siteName.');
    }

    this.siteName = options.siteName;
  }

  async searchLowestPrice() {
    throw new Error(`${this.siteName} scraper has not implemented searchLowestPrice().`);
  }
}

module.exports = BaseScraper;
