const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('chatdb', 'postgres', 'admin', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false, 
});

sequelize.authenticate()
.then(() => console.log('Подключение к БД успешно!'))
.catch(err => console.error('Ошибка подключения к БД:', err));

module.exports = sequelize;