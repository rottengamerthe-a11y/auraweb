# Paddle Sandbox Testing

Use sandbox to test checkout, webhooks, and premium activation without live domain approval or real charges.

## Website config

Edit `api-config.js`:

```js
window.PADDLE_ENVIRONMENT = 'sandbox';
window.PADDLE_CLIENT_TOKEN = 'test_your_sandbox_client_token';
window.PADDLE_MONTHLY_PRICE_ID = 'pri_your_sandbox_monthly_price';
window.PADDLE_YEARLY_PRICE_ID = 'pri_your_sandbox_yearly_price';
window.PADDLE_LIFETIME_PRICE_ID = 'pri_your_sandbox_lifetime_price';
```

The sandbox client token and sandbox price IDs must come from the same Paddle sandbox account.

## Bot config

On the bot Render service, use the sandbox webhook secret and sandbox price IDs:

```env
PADDLE_WEBHOOK_SECRET=your_sandbox_webhook_secret
PADDLE_MONTHLY_PRICE_ID=pri_your_sandbox_monthly_price
PADDLE_YEARLY_PRICE_ID=pri_your_sandbox_yearly_price
PADDLE_LIFETIME_PRICE_ID=pri_your_sandbox_lifetime_price
```

## Paddle sandbox webhook

In Paddle sandbox, set the webhook destination to:

```text
https://YOUR-BOT-SERVICE.onrender.com/paddle/webhook
```

Subscribe to transaction and subscription events, especially:

```text
transaction.completed
transaction.billed
subscription.activated
subscription.updated
subscription.canceled
subscription.paused
subscription.resumed
```

## Test flow

1. Open the website.
2. Login with Discord.
3. Click a premium plan.
4. Complete Paddle sandbox checkout with a Paddle sandbox test card.
5. In Paddle sandbox, confirm the webhook delivery returned HTTP 200.
6. In Discord, run `/premium`.
7. The bot should show the active premium plan.

If the bot does not show premium, check Paddle sandbox webhook delivery response and confirm `custom_data.discord_user_id` is present.
