/**
 * Scraper 注册中心。
 *
 * 以后新增网站时，在这里导入并加入数组即可。
 */

const TripScraper = require('./TripScraper');

function createScrapers() {
  return [
    new TripScraper()
  ];
}

module.exports = {
  createScrapers
};
