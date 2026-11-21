import app from './app.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT || '3000');
const server = app.listen(port, host, () => {
  console.log(`Travel Planner: http://${host}:${server.address().port}`);
});
