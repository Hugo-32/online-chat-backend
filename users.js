const { trimStr } = require("./utils");

let users = [];
const admins = [
    { name: 'Hugo', password: '12345' },
    { name: 'Admin', password: '12345' }
  ];
const blockedUsers = {};

const findUser = ({name, room}) => {
    const isAdmin = admins.includes(name);
    const isBlocked = blockedUsers[name] && 
        (blockedUsers[name].blocked === true || 
         (blockedUsers[name].until && Date.now() < blockedUsers[name].until));
    
    if (isBlocked) {
        return { user: null, error: 'User is blocked' };
    }
    const userName = trimStr(name);
    const userRoom = trimStr(room);

    return users.find(
        (u) => trimStr(u.name) === userName && trimStr(u.room) === userRoom
    );
}

const addUser = (user) => {
    const isExist =  findUser(user);

    !isExist && users.push(user);

    const currentUser = isExist || user;

    return { isExist: !!isExist, user: currentUser };
}

const getRoomUsers = (room) => users.filter((u) => u.room === room);

const removeUser = (user) => {
    const userName = trimStr(user.name);
    const userRoom = trimStr(user.room);

    const found = users.find(
        (u) => trimStr(u.name) === userName && trimStr(u.room) === userRoom
    );

    if(found) {
        users = users.filter(
            ({ room, name }) => !(trimStr(room) === userRoom && trimStr(name) === userName)
        );
        //console.log('Пользователь удалён:', found.name, found.room);
    } else {
        //console.log('Пользователь не найден для удаления:', userName, userRoom);
    }

    //console.log('Текущий users:', users);
    return found;
}

module.exports = { addUser, findUser, getRoomUsers, removeUser, admins, blockedUsers }