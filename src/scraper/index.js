/**
 * 有効な航空券価格 scraper を生成する登録モジュール。
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
