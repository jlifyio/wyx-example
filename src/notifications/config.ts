// Notification configuration
export const config = {
  email: { from: "noreply@example.com", provider: "sendgrid" },
  sms: { provider: "twilio" },
  retryAttempts: 3,
  queueBatchSize: 50,
};
