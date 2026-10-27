// infra/mongo/init-replica.js — chạy bởi healthcheck của service mongo (mongosh).
// Idempotent: thoát 0 chỉ khi node hiện tại là PRIMARY của rs0.
try {
  const status = rs.status();
  quit(status.myState === 1 ? 0 : 1);
} catch (e) {
  // 94 = NotYetInitialized
  if (e.code === 94 || e.codeName === 'NotYetInitialized') {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  }
  quit(1);
}
