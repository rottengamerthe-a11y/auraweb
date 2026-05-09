const PADDLE_CLIENT_TOKEN = 'test_d4eb0ae0fb7f3769c198e959885';
const PADDLE_ENVIRONMENT = 'sandbox';

function initializeAurixPaddle() {
  if (!window.Paddle) {
    console.error('Paddle.js is not loaded.');
    return false;
  }

  if (PADDLE_ENVIRONMENT === 'sandbox') {
    Paddle.Environment.set('sandbox');
  }

  Paddle.Initialize({
    token: PADDLE_CLIENT_TOKEN
  });

  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  const signUpButton = document.getElementById('paddleSignUpButton');

  if (!signUpButton || !initializeAurixPaddle()) {
    return;
  }

  signUpButton.addEventListener('click', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const discordId = urlParams.get('userid');
    const customData = {};

    if (discordId) {
      customData.discord_user_id = discordId;
    }

    Paddle.Checkout.open({
      items: [
        {
          priceId: signUpButton.dataset.priceId,
          quantity: 1
        }
      ],
      customData
    });
  });
});
