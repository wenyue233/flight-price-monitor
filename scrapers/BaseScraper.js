/**
 * Scraper 抽象基类。
 *
 * 新增 Spring 官网、携程、Google Flights、Skyscanner 时，
 * 建议都继承这个类，并实现 searchLowestPrice(route)。
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
