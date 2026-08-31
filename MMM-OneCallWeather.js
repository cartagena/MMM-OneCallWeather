//let data;

Module.register("MMM-OneCallWeather", {
  defaults: {
    latitude: false,
    longitude: false,
    apikey: "",
    apiVersion: "3.0",
    units: config.units,
    layout: "default",
    showRainAmount: false,
    showWind: true,
    showWindDirection: true,
    showFeelsLike: true,
    tempUnits: "c",
    windUnits: "mph",
    useBeaufortInCurrent: false,

    initialLoadDelay: 2500, // 2.5 seconds delay. This delay is used to keep the OpenWeather API happy.
    updateInterval: 10 * 60 * 1000, // every 10 minutes
    animationSpeed: 1000,
    updateFadeSpeed: 500,
    lang: config.language,
    language: config.language,
    requestDelay: 0,

    decimalSymbol: ".",
    fade: true,
    scale: false,
    exclude: "minutely",

    iconset: "4a",
    iconsetFormat: "png",

    maxHourliesToShow: 7,
    maxDailiesToShow: 5,
    roundTemp: true,
    moduleTimestampIdPrefix: "OPENWEATHER_ONE_CALL_TIMESTAMP_"
  },

  // create a variable for the first upcoming calendar event. Used if no location is specified.
  firstEvent: false,

  // Define required scripts.
  getScripts () {
    return [
      this.file("node_modules/dayjs/dayjs.min.js"),
      this.file("node_modules/dayjs/plugin/isBetween.js"),
      this.file("node_modules/dayjs/plugin/utc.js"),
      this.file(`node_modules/dayjs/locale/${config.language}.js`)
    ];
  },

  // Define required CSS files.
  getStyles () {
    return ["MMM-OneCallWeather.css"];
  },

  getTranslations () {
    return {
      de: "translations/de.json",
      en: "translations/en.json",
      fr: "translations/fr.json"
    };
  },

  // Define start sequence.
  start () {
    Log.info(`Starting module: ${this.name}`);
    // Set locale.
    dayjs.locale(config.language);
    dayjs.extend(window.dayjs_plugin_isBetween);
    dayjs.extend(window.dayjs_plugin_utc);
    this.forecast = [];
    
    this.loaded = false;
    this.scheduleUpdate(this.config.initialLoadDelay);
    this.updateTimer = null;
  },

  scheduleUpdate (delay) {
    let nextLoad = this.config.updateInterval;
    if (typeof delay !== "undefined" && delay >= 0) {
      nextLoad = delay;
    }

    const self = this;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      self.updateWeather();
    }, nextLoad);
  },

  updateWeather () {
    this.sendSocketNotification("OPENWEATHER_ONECALL_GET", {
      apikey: this.config.apikey,
      apiVersion: this.config.apiVersion,
      exclude: this.config.exclude,
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      units: this.config.units,
      language: this.config.language,
      requestDelay: this.config.requestDelay,
      sensorType: this.config.sensorType,
      sensorPin: this.config.sensorPin
    });
  },

  socketNotificationReceived (notification, payload) {
    if (notification === "OPENWEATHER_ONECALL_DATA") {
      Log.info("Received notification: " + notification)
      
      this.forecast = this.processOnecall(payload);
      this.loaded = true;
      this.updateDom();
      this.scheduleUpdate();
    }
  },

  processOnecall (data) {
    let precip = false;
    let wsfactor = 2.237;
    let currently;
    if (this.config.windUnits === "kmph") {
      wsfactor = 3.6;
    } else if (this.config.windUnits === "ms") {
      wsfactor = 1;
    }

    if (Object.hasOwn(data, "current")) {
      currently = {
        date: dayjs.unix(data.current.dt).utcOffset(data.timezone_offset / 60),
        dayOfWeek: dayjs.unix(data.current.dt).format("ddd"),
        windSpeed: (data.current.wind_speed * wsfactor).toFixed(0),
        windDirection: data.current.wind_deg,
        sunrise: dayjs.unix(data.current.sunrise).utcOffset(data.timezone_offset / 60),
        sunset: dayjs.unix(data.current.sunset).utcOffset(data.timezone_offset / 60),
        temperature: data.current.temp.toFixed(1),
        weatherIcon: data.current.weather[0].icon,
        humidity: data.current.humidity,
        feelsLikeTemp: data.current.feels_like.toFixed(1),
        //precipitation: current.rain + current.snow
      };
    }

    // get hourly weather, if requested
    const hours = [];
    this.hourForecast = [];
    let forecastData;

    if (Object.hasOwn(data, "hourly")) {
      for (const hour of data.hourly) {
        let precipitation = 0;
        if (Object.hasOwn(hour, "rain") && !Number.isNaN(hour.rain["1h"])) {
          precipitation += this.config.units === "imperial" ? hour.rain["1h"] / 25.4 : hour.rain["1h"];
        }
        if (Object.hasOwn(hour, "snow") && !Number.isNaN(hour.snow["1h"])) {
          precipitation += this.config.units === "imperial" ? hour.snow["1h"] / 25.4 : hour.snow["1h"];
        }

        forecastData = {
          date: dayjs.unix(hour.dt).utcOffset(data.timezone_offset / 60),
          temperature: hour.temp,
          humidity: hour.humidity,
          windSpeed: hour.wind_speed,
          windDirection: hour.wind_deg,
          feelsLikeTemp: hour.feels_like.day,
          weatherIcon: hour.weather[0].icon,
          precipitation: precipitation
        };
        hours.push(forecastData);
      }
    }

    // get daily weather, if requested
    this.dayForecast = [];

    const days = [];
    if (Object.hasOwn(data, "daily")) {
      for (const day of data.daily) {
        let precipitation = 0;
        if (!Number.isNaN(day.rain)) {
          precipitation += this.config.units === "imperial" ? day.rain / 25.4 : day.rain;
        }
        if (!Number.isNaN(day.snow)) {
          precipitation += this.config.units === "imperial" ? day.snow / 25.4 : day.snow;
        }

        forecastData = {
          dayOfWeek: dayjs.unix(day.dt).format("ddd"),
          date: dayjs.unix(day.dt).utcOffset(data.timezone_offset / 60),
          sunrise: dayjs.unix(day.sunrise).utcOffset(data.timezone_offset / 60),
          sunset: dayjs.unix(day.sunset).utcOffset(data.timezone_offset / 60),
          minTemperature: this.roundValue(day.temp.min),
          maxTemperature: this.roundValue(day.temp.max),
          humidity: day.humidity,
          windSpeed: (day.wind_speed * wsfactor).toFixed(0),
          windDirection: day.wind_deg,
          feelsLikeTemp: day.feels_like.day,
          weatherIcon: day.weather[0].icon,
          precipitation: precipitation
        };

        days.push(forecastData);
      }
    }

    const indoor = {}
    if (Object.hasOwn(data, "indoor")) {
      let indoorTemperature = null
      if (data.indoor.temperature != null) {
        indoorTemperature = this.config.units === "imperial" ? 
        (data.indoor.temperature * 9 / 5 + 32).toFixed(1) : 
        parseFloat(data.indoor.temperature).toFixed(1);
      }
  
      let indoorHumidity = null
      if (data.indoor.humidity != null) {
        indoorHumidity = parseFloat(data.indoor.humidity).toFixed(1);
      }
  
      indoor.temperature = indoorTemperature;
      indoor.humidity = indoorHumidity;
    }

    // Log.debug("forecast is " + JSON.stringify(days));
    return {currently, hours, days, indoor};
  },

  // Override dom generator.
  getDom () {
    const wrapper = document.createElement("div");
    wrapper.className = "OCW"

    if (this.config.appid === "") {
      wrapper.innerHTML = `Please set the correct openweather <i>appid</i> in the config for module: ${this.name}.`;
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.innerHTML = this.translate("LOADING");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    const weatherContainer = document.createElement("div");
    weatherContainer.style.borderCollapse = "collapse";
    weatherContainer.className = "OCW weather-container"

    let degreeLabel = "°";
    if (this.config.scale) {
      switch (this.config.units) {
        case "metric":
          degreeLabel += "C";
          break;
        case "imperial":
          degreeLabel += "F";
          break;
        default:
          degreeLabel = "K";
          break;
      }
    }

    if (this.config.decimalSymbol === "") {
      this.config.decimalSymbol = ".";
    }

    // current temps
    createCurrentWeatherDom.call(this);

    // daily forecast
    const [globalMinTemp, globalMaxTemp] = calculateForestMaxMinTemps.call(this);

    const forecastContainer = document.createElement("div");
    forecastContainer.className = "weather-forecast-container";

    let dailyForecast;
    for (let j = 0; j < this.config.maxDailiesToShow; j += 1) {          
      dailyForecast = this.forecast.days[j];
      createForecastDayBarsDom.call(this, dailyForecast, globalMinTemp, globalMaxTemp, forecastContainer);      
    }
  
    weatherContainer.appendChild(forecastContainer);
    
    return weatherContainer;

    function calculateForestMaxMinTemps() {
      let globalMinTemp = 50;
      let globalMaxTemp = 0;
      for (let j = 0; j < this.config.maxDailiesToShow; j += 1) {
        this.dailyForecast = this.forecast.days[j];
        const currentMinTemp = parseInt(this.dailyForecast.minTemperature);
        const currentMaxTemp = parseInt(this.dailyForecast.maxTemperature);
  
        globalMinTemp = Math.min(globalMinTemp, currentMinTemp);
        globalMaxTemp = Math.max(globalMaxTemp, currentMaxTemp);
      }

      return [globalMinTemp, globalMaxTemp];
    } 

    function createForecastDayBarsDom(dailyForecast, globalMinTemp, globalMaxTemp, forecastContainer) {
      const forecastDayRowContainer = document.createElement("div");
      forecastDayRowContainer.className = "forecast-row";

      {
        const dayDiv = document.createElement("div");
        dayDiv.className = "day";
        dayDiv.innerHTML = dailyForecast.dayOfWeek;
        forecastDayRowContainer.appendChild(dayDiv);
      }
      {
        const iconDiv = document.createElement("div");
        iconDiv.className = "icon";
        iconDiv.style = `background-image: url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${dailyForecast.weatherIcon}.${this.config.iconsetFormat}');`;
        forecastDayRowContainer.appendChild(iconDiv);
      }
      {
        const minTempDiv = document.createElement("div");
        minTempDiv.className = "low-temp";
        minTempDiv.innerHTML = `${dailyForecast.minTemperature}${degreeLabel}`;
        forecastDayRowContainer.appendChild(minTempDiv);
      }
      {
        const tempBarDiv = document.createElement("div");
        tempBarDiv.className = "temp-bar";

        const tempBarFillDiv = document.createElement("div");
        tempBarFillDiv.className = "fill";

        // calculates the bar color gradient
        const minTemp = parseInt(dailyForecast.minTemperature);
        const maxTemp = parseInt(dailyForecast.maxTemperature);

        const tempRange = maxTemp - minTemp;
        const colorStops = [];
        for (let t = minTemp; t <= maxTemp; t++) {
          const color = this.getTemperatureColor(t);
          const position = ((t - minTemp) / tempRange) * 100;
          colorStops.push(`${color} ${position}%`);
        }

        // Create the gradient string
        const gradientString = `linear-gradient(to right, ${colorStops.join(', ')})`;

        // Apply styles dynamically
        const minDiff = minTemp - globalMinTemp;
        const maxDiff = globalMaxTemp - maxTemp;

        const a = (minDiff / (globalMaxTemp - globalMinTemp)) * 100;
        const b = (maxDiff / (globalMaxTemp - globalMinTemp)) * 100;

        tempBarFillDiv.style.marginLeft = `${a}px`;
        tempBarFillDiv.style.marginRight = `${b}px`;
        tempBarFillDiv.style.background = gradientString; // Set gradient color

        tempBarDiv.appendChild(tempBarFillDiv);
        forecastDayRowContainer.appendChild(tempBarDiv);
      }
      {
        const maxTempDiv = document.createElement("div");
        maxTempDiv.className = "high-temp";
        maxTempDiv.innerHTML = `${dailyForecast.maxTemperature}${degreeLabel}`;
        forecastDayRowContainer.appendChild(maxTempDiv);
      }

      forecastContainer.appendChild(forecastDayRowContainer);
      
    }

    function createCurrentWeatherDom() {
      const currentWeather = this.forecast.currently;
      const indoorConditions = this.forecast.indoor;

      const currentLocationContainer = document.createElement("div");
      currentLocationContainer.className = "location-text";
      currentLocationContainer.innerHTML = this.config.displayName;

      const currentWeatherIconContainer = document.createElement("div");
      currentWeatherIconContainer.className = "current-weather-icon";
      currentWeatherIconContainer.style = `background-image: url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${currentWeather.weatherIcon}.${this.config.iconsetFormat}');`;

      const currentTempContainer = document.createElement("div");
      currentTempContainer.className = 'current-temperature';
      currentTempContainer.innerHTML = `${currentWeather.temperature}${degreeLabel}`;

      const currentFeelsLikeContainer = document.createElement("div");
      currentFeelsLikeContainer.className = "current-feelslike";
      currentFeelsLikeContainer.innerHTML = `Feels like ${currentWeather.feelsLikeTemp}${degreeLabel}`;

      const currentTempFeelsLikeContainer = document.createElement("div");
      currentTempFeelsLikeContainer.className = "current-temp-feelslike";
      currentTempFeelsLikeContainer.appendChild(currentTempContainer);
      currentTempFeelsLikeContainer.appendChild(currentFeelsLikeContainer);

      const comboContainer = document.createElement("div");
      comboContainer.className = 'current-combo';
      comboContainer.appendChild(currentWeatherIconContainer);
      comboContainer.appendChild(currentTempFeelsLikeContainer);

      const indoorConditionsContainer = document.createElement("div");
      indoorConditionsContainer.className = 'current-indoor';
      indoorConditionsContainer.innerHTML = `Indoor: ${indoorConditions.temperature != null ? indoorConditions.temperature + degreeLabel : "Not Available"}`;

      const hourlyForecastContainer = document.createElement("div");
      hourlyForecastContainer.className = 'hourly-forecast';

      for (let j = 1; j < this.config.maxHourliesToShow; j += 1) {          
        const hourForecast = this.forecast.hours[j];
        
        const hourDiv = document.createElement("div");
        hourDiv.className = "hourly-hour";
        hourDiv.innerHTML = hourForecast.date.hour()
      
        const iconDiv = document.createElement("div");
        iconDiv.className = "hourly-icon";
        iconDiv.style = `background-image: url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${hourForecast.weatherIcon}.${this.config.iconsetFormat}');`;
        
        const temperatureDiv = document.createElement("div");
        temperatureDiv.className = "hourly-temperature";
        temperatureDiv.innerHTML = hourForecast.temperature.toFixed(0) + degreeLabel

        const hourForecastContainer = document.createElement("div");
        hourForecastContainer.appendChild(hourDiv);
        hourForecastContainer.appendChild(iconDiv);
        hourForecastContainer.appendChild(temperatureDiv);

        hourlyForecastContainer.appendChild(hourForecastContainer);
      }
      
      const currentWeatherContainer = document.createElement("div");
      currentWeatherContainer.className = "current-weather";

      //currentWeatherContainer.appendChild(currentLocationContainer);
      currentWeatherContainer.appendChild(comboContainer);
      currentWeatherContainer.appendChild(hourlyForecastContainer);
      //currentWeatherContainer.appendChild(currentFeelsLikeContainer);
      //currentWeatherContainer.appendChild(indoorConditionsContainer);
      weatherContainer.appendChild(currentWeatherContainer);
    }
  },

  roundValue (temperature) {
    const decimals = this.config.roundTemp ? 0 : 1;
    return parseFloat(temperature).toFixed(decimals);
  },

  getTemperatureColor(temperature) {
    // Define the temperature-color mapping
    const tempColorMap = [
        { temp: 0, color: "#5ecde8" },
        { temp: 5, color: "#60cfe0" },
        { temp: 10, color: "#64d3d3" },
        { temp: 15, color: "#8bd4ba" },
        { temp: 20, color: "#d9d170" },
        { temp: 25, color: "#ffbd01" },
        { temp: 30, color: "#ff811a" },
        { temp: 35, color: "#ff592b" },
        { temp: 40, color: "#e83328" },
        { temp: 45, color: "#8e2825" },
    ];

    // Helper function to interpolate between two colors
    function interpolateColor(color1, color2, factor) {
        const c1 = parseInt(color1.slice(1), 16); // Convert hex to integer
        const c2 = parseInt(color2.slice(1), 16);
        const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
        const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;

        // Interpolate each channel
        const r = Math.round(r1 + factor * (r2 - r1));
        const g = Math.round(g1 + factor * (g2 - g1));
        const b = Math.round(b1 + factor * (b2 - b1));

        // Convert back to hex
        return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    }

    // Find the temperature range
    for (let i = 0; i < tempColorMap.length - 1; i++) {
        const lower = tempColorMap[i];
        const upper = tempColorMap[i + 1];

        if (temperature >= lower.temp && temperature <= upper.temp) {
            // Calculate the interpolation factor
            const factor = (temperature - lower.temp) / (upper.temp - lower.temp);
            return interpolateColor(lower.color, upper.color, factor);
        }
    }

    // If the temperature is out of bounds, return the nearest bound color
    if (temperature < tempColorMap[0].temp) return tempColorMap[0].color;
    if (temperature > tempColorMap[tempColorMap.length - 1].temp) return tempColorMap[tempColorMap.length - 1].color;
  }
  
});