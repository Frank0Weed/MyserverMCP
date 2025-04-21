// server.js - Node.js API Bridge for MT5 price data
const express = require('express');
const http = require('http');
const net = require('net');
const bodyParser = require('body-parser');

// Configuration
const CONFIG = {
  HTTP_PORT: 3000,
  SOCKET_PORT: 8308,
  SOCKET_HOST: '0.0.0.0'
};

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// In-memory storage for received MT5 data
const dataStore = {
  livePrices: {},  // Symbol -> latest price data
  ohlcvData: {},   // Symbol -> timeframe -> array of candles
  symbolList: []   // List of available symbols
};

// Create HTTP server
const httpServer = http.createServer(app);

// ==========================================
// Socket Server for MT5 Connection
// ==========================================
const socketServer = net.createServer((socket) => {
  console.log('MT5 client connected from', socket.remoteAddress);
  
  let buffer = '';
  
  socket.on('data', (data) => {
    // Append data to buffer and process complete JSON objects
    buffer += data.toString();
    
    // Process complete messages (separated by newlines)
    const messages = buffer.split('\n');
    buffer = messages.pop(); // Keep the last incomplete message in buffer
    
    for (const message of messages) {
      if (message.trim() === '') continue;
      
      try {
        const jsonData = JSON.parse(message);
        processIncomingData(jsonData);
      } catch (error) {
        console.error('Error processing data:', error.message, 'Raw data:', message);
      }
    }
  });
  
  socket.on('end', () => {
    console.log('MT5 client disconnected');
  });
  
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
});

// Process incoming data from MT5
function processIncomingData(data) {
  const timestamp = new Date().toISOString();
  
  switch (data.type) {
    case 'live_price':
      // Store live price by symbol
      if (!data.symbol) {
        console.error('Missing symbol in live price data');
        return;
      }
      data.receivedAt = timestamp;
      dataStore.livePrices[data.symbol] = data;
      break;
      
    case 'ohlcv':
      // Store OHLCV data by symbol and timeframe
      if (!data.symbol || !data.timeframe) {
        console.error('Missing symbol or timeframe in OHLCV data');
        return;
      }
      
      if (!dataStore.ohlcvData[data.symbol]) {
        dataStore.ohlcvData[data.symbol] = {};
      }
      
      if (!dataStore.ohlcvData[data.symbol][data.timeframe]) {
        dataStore.ohlcvData[data.symbol][data.timeframe] = [];
      }
      
      // Add received timestamp
      data.receivedAt = timestamp;
      
      // Store the entire candle array
      dataStore.ohlcvData[data.symbol][data.timeframe] = data.candles;
      console.log(`Received ${data.candles.length} candles for ${data.symbol} ${data.timeframe}`);
      break;
      
    case 'symbol_list':
      // Store available symbols
      if (Array.isArray(data.symbols)) {
        dataStore.symbolList = data.symbols;
        console.log(`Received symbol list with ${data.symbols.length} symbols`);
      }
      break;
      
    default:
      console.log('Unknown data type:', data.type);
  }
}

// ==========================================
// REST API Endpoints
// ==========================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    socketServerRunning: true,
    symbolCount: dataStore.symbolList.length,
    priceCount: Object.keys(dataStore.livePrices).length
  });
});

// Get all available symbols
app.get('/api/symbols', (req, res) => {
  res.json({ 
    count: dataStore.symbolList.length,
    symbols: dataStore.symbolList
  });
});

// Get live price for specific symbol
app.get('/api/price/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const priceData = dataStore.livePrices[symbol];
  
  if (!priceData) {
    return res.status(404).json({ error: `No price data available for ${symbol}` });
  }
  
  res.json(priceData);
});

// Get all live prices
app.get('/api/prices', (req, res) => {
  res.json({
    count: Object.keys(dataStore.livePrices).length,
    prices: dataStore.livePrices
  });
});

// Get OHLCV data for specific symbol and timeframe
app.get('/api/ohlcv/:symbol/:timeframe', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const timeframe = req.params.timeframe;
  const limit = parseInt(req.query.limit) || 100;
  
  // Check if data exists
  if (!dataStore.ohlcvData[symbol] || !dataStore.ohlcvData[symbol][timeframe]) {
    return res.status(404).json({ 
      error: `No OHLCV data available for ${symbol} on ${timeframe} timeframe` 
    });
  }
  
  // Get the data with limit
  const candles = dataStore.ohlcvData[symbol][timeframe].slice(-limit);
  
  res.json({
    symbol: symbol,
    timeframe: timeframe,
    count: candles.length,
    candles: candles
  });
});

// Get available timeframes for a symbol
app.get('/api/timeframes/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  
  if (!dataStore.ohlcvData[symbol]) {
    return res.status(404).json({ error: `No data available for ${symbol}` });
  }
  
  const timeframes = Object.keys(dataStore.ohlcvData[symbol]);
  
  res.json({
    symbol: symbol,
    timeframes: timeframes
  });
});

// Request specific OHLCV data from MT5
app.post('/api/request-ohlcv', (req, res) => {
  const { symbol, timeframe, bars } = req.body;
  
  if (!symbol || !timeframe) {
    return res.status(400).json({ error: 'Symbol and timeframe are required' });
  }
  
  // In a real implementation, you would forward this request to MT5
  // For now, we just acknowledge it
  console.log(`Request for ${symbol} ${timeframe} OHLCV data (${bars || 100} bars)`);
  
  res.json({ 
    status: 'requested',
    message: `Requested ${symbol} ${timeframe} data. It will be available when MT5 sends it.`,
    symbol: symbol,
    timeframe: timeframe,
    requestedBars: bars || 100
  });
});

// Start servers
httpServer.listen(CONFIG.HTTP_PORT, () => {
  console.log(`HTTP server listening on port ${CONFIG.HTTP_PORT}`);
});

socketServer.listen(CONFIG.SOCKET_PORT, CONFIG.SOCKET_HOST, () => {
  console.log(`Socket server listening on ${CONFIG.SOCKET_HOST}:${CONFIG.SOCKET_PORT}`);
});