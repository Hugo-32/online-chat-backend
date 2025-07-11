const { DataTypes } = require('sequelize');
const sequelize = require('./db');
const User = require('./User');

const Message = sequelize.define('Message', {
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  room: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING,
    defaultValue: 'text', // text, image, video, file
  },
  fileUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isHidden: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  hiddenReason: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

// Связь: сообщение принадлежит пользователю
Message.belongsTo(User, { foreignKey: 'userId' });

module.exports = Message;