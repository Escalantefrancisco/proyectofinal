const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

// Configura estas credenciales desde Google Cloud Console

const GMAIL_CONFIG = {
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  user: process.env.GMAIL_USER // tu correo de Gmail
};

const createTransporter = async () => {
  const oauth2Client = new OAuth2(
    GMAIL_CONFIG.clientId,
    GMAIL_CONFIG.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth2Client.setCredentials({
    refresh_token: GMAIL_CONFIG.refreshToken
  });

  try {
    const accessToken = await new Promise((resolve, reject) => {
      oauth2Client.getAccessToken((err, token) => {
        if (err) {
          console.log('Failed to create access token', err);
          reject(err);
        }
        resolve(token);
      });
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: GMAIL_CONFIG.user,
        accessToken,
        clientId: GMAIL_CONFIG.clientId,
        clientSecret: GMAIL_CONFIG.clientSecret,
        refreshToken: GMAIL_CONFIG.refreshToken
      }
    });

    return transporter;
  } catch (err) {
    console.error('Error creating transporter:', err);
    return null;
  }
};

module.exports = { createTransporter };
