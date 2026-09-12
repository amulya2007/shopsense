const request = require('supertest');
const app = require('../server/index'); // assuming index.js exports the Express app

describe('Health endpoint', () => {
  it('should return status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
