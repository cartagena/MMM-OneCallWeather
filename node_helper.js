/*
 * Node Helper for MMM-OneCallWeather.
 *
 * This helper is responsible for the data pull from OpenWeather.
 * At a minimum the API key, Latitude and Longitude parameters
 * must be provided.  If any of these are missing, the request
 * to OpenWeather will not be executed, and instead an error
 * will be output the the MagicMirror log.
 *
 * Additional, this module supplies two optional parameters:
 *
 *  units - one of "metric", "imperial", or "" (blank)
 *  lang - Any of the languages OpenWeather supports, as listed here: https://openweathermap.org/api/one-call-api#multi
 */
const NodeHelper = require("node_helper");
const Log = require("logger");
const dayjs = require("dayjs");
const sensor = require("node-dht-sensor");

module.exports = NodeHelper.create({

  socketNotificationReceived (notification, config) {
    if (notification !== "OPENWEATHER_ONECALL_GET") {
      return;
    }

    Log.debug("[MMM-OneCallWeather] node received");
    if (!config.apikey) {
      Log.error(`[MMM-OneCallWeather] ${dayjs().format("D-MMM-YY HH:mm")} ** ERROR ** No API key configured. Get an API key at https://openweathermap.org/api/one-call-api`);
      return;
    }
    
    if (!config.latitude || !config.longitude) {
      Log.error(`[MMM-OneCallWeather] ${dayjs().format("D-MMM-YY HH:mm")} ** ERROR ** Latitude and/or longitude not provided.`);
      return;
    } 
    
    const self = this;
    const oneCallUrl = self.buildOneCallUrl(config);
    
    fetch(oneCallUrl)
      .then((response) => {
        if (response.status === 200) {
          return response.json();
        }
        throw new Error(response.statusText);
      })
      .then((data) => {
        Log.debug(`[MMM-OneCallWeather] got request loop ${oneCallUrl}`);
        
        if(!config.showIndoor) {
          return data;
        }

        return self.readSensor(config).then((sensorData) => {
          data.indoor = sensorData;
          return data;
        });
      })
      .then((data) => {
        self.sendSocketNotification("OPENWEATHER_ONECALL_DATA", data);
        Log.debug("[MMM-OneCallWeather] sent the data back");
      })
      .catch((error) => {
        Log.error(`[MMM-OneCallWeather] ${dayjs().format("D-MMM-YY HH:mm")} ** ERROR ** ${error}`);
      });
  },

  readSensor(config) {
    return new Promise((resolve) => {
      sensor.read(config.sensorType, config.sensorPin, (err, temperature, humidity) => {
        if (err) {
          Log.error(`[MMM-OneCallWeather] Error reading sensor data: ${err}`);
          resolve({ temperature: null, humidity: null });
        } else {
          Log.debug(`[MMM-OneCallWeather] Successfully read sensor data [${temperature} - ${humidity}]`);
          resolve({
            temperature: temperature.toFixed(2),
            humidity: humidity.toFixed(2),
          });
        }
      });
    });
  },  

  buildOneCallUrl (config){
    const baseUrl = `https://api.openweathermap.org/data/${config.apiVersion}/onecall`;
    const params = new URLSearchParams({
      lat: config.latitude,
      lon: config.longitude,
      exclude: config.exclude,
      appid: config.apikey,
      lang: config.language,
    });
    
    if (config.units) {
      params.set('units', config.units);
    }
    
    return `${baseUrl}?${params.toString()}`;
  }
});