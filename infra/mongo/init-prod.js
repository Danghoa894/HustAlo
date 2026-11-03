// infra/mongo/init-prod.js — chạy bởi service mongo-init (development_guide.md §9.3). Idempotent: chạy lại mỗi lần
// `up` không lỗi. Đọc user/mật khẩu app từ process.env (mongosh), không ghi cứng.
/* global rs, db, sleep, process, print */
const appUser = process.env.MONGO_APP_USERNAME;
const appPwd = process.env.MONGO_APP_PASSWORD;
if (!appUser || !appPwd) throw new Error('Thiếu MONGO_APP_USERNAME / MONGO_APP_PASSWORD');

// 1. Khởi tạo replica set một node nếu chưa có (rs.status() ném NotYetInitialized).
let initiated = true;
try {
  rs.status();
} catch (e) {
  if (String(e.codeName || e.message).includes('NotYetInitialized')) initiated = false;
  else throw e;
}
if (!initiated) {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  print('[init-prod] rs.initiate rs0');
}
for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i += 1) sleep(1000);
if (!db.hello().isWritablePrimary) throw new Error('replica set chưa có primary sau 60 s');

// 2. User root do MONGO_INITDB_ROOT_* tạo ở lần khởi động đầu. 3. User app chỉ readWrite trên DB hustalo.
const app = db.getSiblingDB('hustalo');
if (!app.getUser(appUser)) {
  app.createUser({ user: appUser, pwd: appPwd, roles: [{ role: 'readWrite', db: 'hustalo' }] });
  print(`[init-prod] tạo user app ${appUser}`);
} else {
  print(`[init-prod] user app ${appUser} đã có`);
}
