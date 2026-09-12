// Swagger setup for ShopSense API
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerJSDoc = require('swagger-jsdoc');

  const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'ShopSense API',
        version: '1.0.0',
        description: 'API documentation for ShopSense platform',
      },
      servers: [{ url: process.env.API_BASE_URL || 'http://localhost:4000' }],
    },
    // Path to the API docs (JSDoc comments in route files)
    apis: ['./routes/*.js'],
  };

  const swaggerSpec = swaggerJSDoc(options);
  module.exports = (app) => {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  };
} else {
  // No Swagger UI in production
  module.exports = () => {};
}
