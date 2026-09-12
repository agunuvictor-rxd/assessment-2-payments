import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { paymentsRouter } from './routes/payments.js';
import { viewsRouter } from './routes/views.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // Preserve rawBody for HMAC webhook verification
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf-8');
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(config.sessionSecret));

  // Mount API & views
  app.use('/api/auth', authRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/', viewsRouter);

  // 404 handler
  app.use((req, res) => {
    if (req.accepts('html')) {
      return res.status(404).send(`
        <body style="background:#0b0f19;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
          <div style="text-align:center;">
            <h1>404 - Page Not Found</h1>
            <p><a href="/billing" style="color:#38bdf8;">Return to Billing</a></p>
          </div>
        </body>
      `);
    }
    return res.status(404).json({ success: false, error: 'Not found' });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled billing error:', err);
    res.status(500).json({ success: false, error: 'Internal server error in billing slice.' });
  });

  return app;
}
