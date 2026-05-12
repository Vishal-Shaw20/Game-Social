const otpStore = new Map();

const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore) {
    if (record.expiresAt && now > record.expiresAt) {
      otpStore.delete(email);
    }
  }
}, CLEANUP_INTERVAL).unref();

export default otpStore;
