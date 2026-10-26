'use strict';

const { app } = require('electron');

const DICTIONARIES = {
  ru: require('../locales/ru.json'),
  en: require('../locales/en.json'),
};

let language = 'ru';

/** 'auto' follows Windows: Russian for ru-*, English for everything else. */
function resolveLanguage(setting) {
  if (DICTIONARIES[setting]) return setting;
  return app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function setLanguage(setting) {
  language = resolveLanguage(setting);
  return language;
}

function t(key, vars = {}) {
  const value = DICTIONARIES[language][key] ?? DICTIONARIES.ru[key] ?? key;
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

module.exports = { setLanguage, t };
