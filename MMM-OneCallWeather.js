Module.register('MMM-OneCallWeather', {
  // Import utilities
  utils: null,

  defaults: {
    latitude: false,
    longitude: false,
    apikey: '',
    apiVersion: '3.0',
    units: config.units,
    showFeelsLike: true,
    tempUnits: 'c',
    windUnits: 'mph',
    useBeaufortInCurrent: false,

    initialLoadDelay: 2500, // 2.5 seconds delay. This delay is used to keep the OpenWeather API happy.
    updateInterval: 10 * 60 * 1000, // every 10 minutes
    animationSpeed: 1000,
    updateFadeSpeed: 500,
    requestDelay: 0,

    decimalSymbol: '.',
    fade: true,
    scale: false,
    exclude: 'minutely',

    iconset: '4a',
    iconsetFormat: 'png',

    maxHourliesToShow: 6,
    maxDailiesToShow: 5,
    roundTemp: false,

    labelOrdinals: [
      'N',
      'NNE',
      'NE',
      'ENE',
      'E',
      'ESE',
      'SE',
      'SSE',
      'S',
      'SSW',
      'SW',
      'WSW',
      'W',
      'WNW',
      'NW',
      'NNW',
    ],
    moduleTimestampIdPrefix: 'OPENWEATHER_ONE_CALL_TIMESTAMP_',
  },

  // create a variable for the first upcoming calendar event. Used if no location is specified.
  firstEvent: false,

  // Define required CSS files.
  getStyles() {
    return ['MMM-OneCallWeather.css']
  },

  // Define start sequence.
  async start() {
    Log.info(`Starting module: ${this.name}`)

    // Load utilities
    this.utils = await import('./core/utils.mjs')

    this.forecast = []
    this.loaded = false
    this.scheduleUpdate(this.config.initialLoadDelay)
    this.updateTimer = null
  },

  scheduleUpdate(delay) {
    let nextLoad = this.config.updateInterval
    if (typeof delay !== 'undefined' && delay >= 0) {
      nextLoad = delay
    }

    const that = this
    clearTimeout(this.updateTimer)
    this.updateTimer = setTimeout(() => {
      that.updateWeather()
    }, nextLoad)
  },

  updateWeather() {
    this.sendSocketNotification('OPENWEATHER_ONECALL_GET', {
      identifier: this.identifier,
      apikey: this.config.apikey,
      apiVersion: this.config.apiVersion,
      exclude: this.config.exclude,
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      units: this.config.units,
      language: this.config.language,
      requestDelay: this.config.requestDelay,
    })
  },

  socketNotificationReceived(notification, payload) {
    if (notification === 'OPENWEATHER_ONECALL_DATA' && payload.identifier === this.identifier) {
      // process weather data
      const { data } = payload
      this.forecast = this.processOnecall(data)
      this.loaded = true
      this.updateDom()
      this.scheduleUpdate()
    }
  },

  processOnecall(data) {
    const wsfactor = this.utils.getWindSpeedFactor(this.config.units, this.config.windUnits)
    const current = []

    if (Object.hasOwn(data, 'current')) {
      const currently = {
        date: new Date((data.current.dt + data.timezone_offset) * 1000),
        dayOfWeek: new Intl.DateTimeFormat(config.language, { weekday: 'short' }).format(data.current.dt),
        windSpeed: (data.current.wind_speed * wsfactor).toFixed(0),
        windDirection: data.current.wind_deg,
        sunrise: new Date((data.current.sunrise + data.timezone_offset) * 1000),
        sunset: new Date((data.current.sunset + data.timezone_offset) * 1000),
        temperature: this.roundValue(data.current.temp),
        weatherIcon: data.current.weather[0].icon,
        weatherType: this.convertWeatherType(data.current.weather[0].icon),
        humidity: data.current.humidity,
        feelsLikeTemp: data.current.feels_like.toFixed(1),
        precipitation: this.config.units === 'imperial'
          ? ((data.current.rain?.['1h'] || 0) + (data.current.snow?.['1h'] || 0)) / 25.4
          : (data.current.rain?.['1h'] || 0) + (data.current.snow?.['1h'] || 0),
        dailyRain: (() => {
          const d = data.daily?.[0]
          if (!d) {
            return 0
          }
          const rain = d.rain && !Number.isNaN(d.rain) ? d.rain : 0
          const snow = d.snow && !Number.isNaN(d.snow) ? d.snow : 0
          return this.config.units === 'imperial' ? (rain + snow) / 25.4 : rain + snow
        })(),
      }

      if (Object.hasOwn(data, 'alerts')) {
        currently.alerts = data.alerts
      }
      else {
        currently.alerts = []
      }

      current.push(currently)
      Log.debug(`current weather is ${JSON.stringify(currently)}`)
    }

    // get hourly weather, if requested
    const hours = []
    this.hourForecast = []
    let forecastData

    if (Object.hasOwn(data, 'hourly')) {
      for (const hour of data.hourly) {
        let rain = 0
        let snow = 0

        if (
          Object.hasOwn(hour, 'rain')
          && !Number.isNaN(hour.rain['1h'])
        ) {
          if (this.config.units === 'imperial') {
            rain = hour.rain['1h'] / 25.4
          }
          else {
            rain = hour.rain['1h']
          }
        }
        if (
          Object.hasOwn(hour, 'snow')
          && !Number.isNaN(hour.snow['1h'])
        ) {
          if (this.config.units === 'imperial') {
            snow = hour.snow['1h'] / 25.4
          }
          else {
            snow = hour.snow['1h']
          }
        }

        forecastData = {
          date: new Date((hour.dt + data.timezone_offset) * 1000),
          temperature: hour.temp,
          humidity: hour.humidity,
          windSpeed: hour.wind_speed,
          windDirection: hour.wind_deg,
          feelsLikeTemp: hour.feels_like.day,
          weatherIcon: hour.weather[0].icon,
          weatherType: this.convertWeatherType(hour.weather[0].icon),
          rain,
          snow,
        }
        hours.push(forecastData)
      }
    }

    // get daily weather, if requested
    this.dayForecast = []

    const days = []
    if (Object.hasOwn(data, 'daily')) {
      for (const day of data.daily) {
        let rain = 0
        let snow = 0

        if (day.rain && !Number.isNaN(day.rain)) {
          const { rain: dayRain } = day
          if (this.config.units === 'imperial') {
            rain = dayRain / 25.4
          }
          else {
            rain = dayRain
          }
        }
        if (day.snow && !Number.isNaN(day.snow)) {
          const { snow: daySnow } = day
          if (this.config.units === 'imperial') {
            snow = daySnow / 25.4
          }
          else {
            snow = daySnow
          }
        }

        forecastData = {
          dayOfWeek: new Intl.DateTimeFormat(config.language, { weekday: 'short' }).format(day.dt * 1000),
          date: new Date((day.dt + data.timezone_offset) * 1000),
          sunrise: new Date((day.sunrise + data.timezone_offset) * 1000),
          sunset: new Date((day.sunset + data.timezone_offset) * 1000),
          minTemperature: this.roundValue(day.temp.min),
          maxTemperature: this.roundValue(day.temp.max),
          humidity: day.humidity,
          windSpeed: (day.wind_speed * wsfactor).toFixed(0),
          windDirection: day.wind_deg,
          feelsLikeTemp: day.feels_like.day,
          weatherIcon: day.weather[0].icon,
          weatherType: this.convertWeatherType(day.weather[0].icon),
          rain,
          snow,
        }

        days.push(forecastData)
      }
    }

    return { current,
      hours,
      days }
  },

  // Override dom generator.
  getDom() {
    const wrapper = document.createElement('div')

    if (this.config.apikey === '') {
      wrapper.innerHTML = `Please set the correct openweather <i>apikey</i> in the config for module: ${this.name}.`
      wrapper.className = 'dimmed light small'
      return wrapper
    }

    if (!this.loaded) {
      wrapper.innerHTML = this.translate('LOADING')
      wrapper.className = 'dimmed light small'
      return wrapper
    }

    if (this.config.decimalSymbol === '' || this.config.decimalSymbol === ' ') {
      this.config.decimalSymbol = '.'
    }

    // Check if we have forecast data
    if (!this.forecast || !this.forecast.current || this.forecast.current.length === 0) {
      wrapper.innerHTML = this.translate('LOADING')
      wrapper.className = 'dimmed light small'
      return wrapper
    }

    let degreeLabel = '°'
    if (this.config.scale) {
      switch (this.config.units) {
        case 'metric':
          degreeLabel += 'C'
          break
        case 'imperial':
          degreeLabel += 'F'
          break
        default:
          degreeLabel = 'K'
          break
      }
    }

    const [currentWeather] = this.forecast.current
    const weatherContainer = document.createElement('div')
    weatherContainer.className = 'weather-container'

    weatherContainer.appendChild(buildCurrentPanel.call(this, currentWeather))

    const [globalMin, globalMax] = calcForecastBounds.call(this)
    const forecastContainer = document.createElement('div')
    forecastContainer.className = 'weather-forecast-container'

    for (let j = 0; j < this.config.maxDailiesToShow; j += 1) {
      buildForecastRow.call(this, this.forecast.days[j], globalMin, globalMax, forecastContainer)
    }

    weatherContainer.appendChild(forecastContainer)
    return weatherContainer

    function calcForecastBounds() {
      let globalMin = 50
      let globalMax = 0
      for (let j = 0; j < this.config.maxDailiesToShow; j += 1) {
        const day = this.forecast.days[j]
        globalMin = Math.min(globalMin, parseInt(day.minTemperature))
        globalMax = Math.max(globalMax, parseInt(day.maxTemperature))
      }
      return [globalMin, globalMax]
    }

    function buildForecastRow(day, globalMin, globalMax, container) {
      const row = document.createElement('div')
      row.className = 'forecast-row'

      const dayDiv = document.createElement('div')
      dayDiv.className = 'day'
      dayDiv.textContent = day.dayOfWeek
      row.appendChild(dayDiv)

      const iconDiv = document.createElement('div')
      iconDiv.className = 'forecast-icon'
      iconDiv.style.backgroundImage = `url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${day.weatherIcon}.${this.config.iconsetFormat}')`
      row.appendChild(iconDiv)

      const minDiv = document.createElement('div')
      minDiv.className = 'low-temp'
      minDiv.textContent = `${day.minTemperature}${degreeLabel}`
      row.appendChild(minDiv)

      const barDiv = document.createElement('div')
      barDiv.className = 'temp-bar'

      const fillDiv = document.createElement('div')
      fillDiv.className = 'fill'

      const minTemp = parseInt(day.minTemperature)
      const maxTemp = parseInt(day.maxTemperature)
      const tempRange = maxTemp - minTemp

      const stops = []
      for (let t = minTemp; t <= maxTemp; t++) {
        const pct = tempRange === 0 ? 0 : ((t - minTemp) / tempRange) * 100
        stops.push(`${this.getTemperatureColor(t)} ${pct}%`)
      }
      fillDiv.style.background = `linear-gradient(to right, ${stops.join(', ')})`

      const totalRange = globalMax - globalMin
      if (totalRange > 0) {
        fillDiv.style.marginLeft = `${((minTemp - globalMin) / totalRange) * 100}%`
        fillDiv.style.marginRight = `${((globalMax - maxTemp) / totalRange) * 100}%`
      }

      barDiv.appendChild(fillDiv)
      row.appendChild(barDiv)

      const maxDiv = document.createElement('div')
      maxDiv.className = 'high-temp'
      maxDiv.textContent = `${day.maxTemperature}${degreeLabel}`
      row.appendChild(maxDiv)

      container.appendChild(row)
    }

    function buildCurrentPanel(currentWeather) {
      const iconDiv = document.createElement('div')
      iconDiv.className = 'current-weather-icon'
      iconDiv.style.backgroundImage = `url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${currentWeather.weatherIcon}.${this.config.iconsetFormat}')`

      const tempDiv = document.createElement('div')
      tempDiv.className = 'current-temperature'
      tempDiv.textContent = `${currentWeather.temperature}${degreeLabel}`

      const feelsLikeDiv = document.createElement('div')
      feelsLikeDiv.className = 'current-feelslike'
      feelsLikeDiv.textContent = `Feels like ${currentWeather.feelsLikeTemp}${degreeLabel}`

      const tempFeelsDiv = document.createElement('div')
      tempFeelsDiv.className = 'current-temp-feelslike'
      tempFeelsDiv.appendChild(tempDiv)
      if (this.config.showFeelsLike) {
        tempFeelsDiv.appendChild(feelsLikeDiv)
      }

      const comboDiv = document.createElement('div')
      comboDiv.className = 'current-combo'
      comboDiv.appendChild(iconDiv)
      comboDiv.appendChild(tempFeelsDiv)

      const hourlyDiv = document.createElement('div')
      hourlyDiv.className = 'hourly-forecast'

      for (let j = 1; j <= this.config.maxHourliesToShow; j += 1) {
        const hour = this.forecast.hours[j]
        if (!hour) break

        const hourNumDiv = document.createElement('div')
        hourNumDiv.className = 'hourly-hour'
        hourNumDiv.textContent = hour.date.getUTCHours()

        const hourIconDiv = document.createElement('div')
        hourIconDiv.className = 'hourly-icon'
        hourIconDiv.style.backgroundImage = `url('modules/MMM-OneCallWeather/icons/${this.config.iconset}/${hour.weatherIcon}.${this.config.iconsetFormat}')`

        const hourTempDiv = document.createElement('div')
        hourTempDiv.className = 'hourly-temperature'
        hourTempDiv.textContent = `${hour.temperature.toFixed(0)}${degreeLabel}`

        const hourItem = document.createElement('div')
        hourItem.className = 'hourly-item'
        hourItem.appendChild(hourNumDiv)
        hourItem.appendChild(hourIconDiv)
        hourItem.appendChild(hourTempDiv)

        hourlyDiv.appendChild(hourItem)
      }

      const panel = document.createElement('div')
      panel.className = 'current-weather'
      panel.appendChild(comboDiv)
      panel.appendChild(hourlyDiv)

      return panel
    }
  },

  getTemperatureColor(temperature) {
    const colorMap = [
      { temp: 0, color: '#5ecde8' },
      { temp: 5, color: '#60cfe0' },
      { temp: 10, color: '#64d3d3' },
      { temp: 15, color: '#8bd4ba' },
      { temp: 20, color: '#d9d170' },
      { temp: 25, color: '#ffbd01' },
      { temp: 30, color: '#ff811a' },
      { temp: 35, color: '#ff592b' },
      { temp: 40, color: '#e83328' },
      { temp: 45, color: '#8e2825' },
    ]

    for (let i = 0; i < colorMap.length - 1; i++) {
      const lower = colorMap[i]
      const upper = colorMap[i + 1]
      if (temperature >= lower.temp && temperature <= upper.temp) {
        return interpolate(lower.color, upper.color, (temperature - lower.temp) / (upper.temp - lower.temp))
      }
    }
    return temperature < colorMap[0].temp ? colorMap[0].color : colorMap.at(-1).color

    function interpolate(c1, c2, factor) {
      const n1 = parseInt(c1.slice(1), 16)
      const n2 = parseInt(c2.slice(1), 16)
      const r = Math.round(((n1 >> 16) & 0xff) + factor * (((n2 >> 16) & 0xff) - ((n1 >> 16) & 0xff)))
      const g = Math.round(((n1 >> 8) & 0xff) + factor * (((n2 >> 8) & 0xff) - ((n1 >> 8) & 0xff)))
      const b = Math.round((n1 & 0xff) + factor * ((n2 & 0xff) - (n1 & 0xff)))
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
    }
  },

  getOrdinal(bearing) {
    return this.utils.getOrdinal(bearing, this.config.labelOrdinals)
  },

  cardinalWindDirection(windDir) {
    return this.utils.cardinalWindDirection(windDir)
  },

  getWindSpeedLabel() {
    return this.utils.getWindSpeedLabel(this.config.windUnits)
  },

  // Create a wind badge with centered speed value and compass direction indicator
  createWindBadge(speed, directionDeg) {
    const container = document.createElement('div')
    container.className = 'wind-badge'

    const compass = document.createElement('div')
    compass.className = 'wind-compass'
    compass.style.transform = `rotate(${directionDeg}deg)`
    container.appendChild(compass)

    const value = document.createElement('span')
    value.className = 'wind-value'
    value.textContent = speed
    container.appendChild(value)

    return container
  },

  roundValue(temperature) {
    return this.utils.roundValue(temperature, this.config.roundTemp)
  },

  /*
   * Convert the OpenWeatherMap icons to a more usable name.
   */
  convertWeatherType(weatherType) {
    return this.utils.convertWeatherType(weatherType)
  },

  /*
   * mph2Beaufort(mph)
   * Converts mph to beaufort (windspeed).
   *
   * see:
   *  https://www.spc.noaa.gov/faq/tornado/beaufort.html
   *  https://en.wikipedia.org/wiki/Beaufort_scale#Modern_scale
   *
   * argument mph number - Windspeed in mph.
   *
   * return number - Windspeed in beaufort.
   */
  mph2Beaufort(mph) {
    return this.utils.mph2Beaufort(mph)
  },
  getAlertLocale() {
    if (this.config.language) {
      return this.config.language
    }
    return typeof config === 'undefined' ? null : config.language
  },
  formatAlertTime(timestampSeconds) {
    if (!timestampSeconds) {
      return '--'
    }
    const locale = this.getAlertLocale()
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestampSeconds * 1000))
  },
  formatAlertDateTime(timestampSeconds) {
    if (!timestampSeconds) {
      return '--'
    }
    const locale = this.getAlertLocale()
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestampSeconds * 1000))
  },
  showAlertPopup(alert) {
    // Create overlay
    const overlay = document.createElement('div')
    overlay.className = 'alert-overlay'
    const escapeController = new AbortController()
    const removeOverlay = () => {
      overlay.remove()
      escapeController.abort()
    }
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        removeOverlay()
      }
    }
    // Make sure it blocks all clicks to underlying modules
    overlay.style.position = 'fixed'
    overlay.style.top = '0'
    overlay.style.left = '0'
    overlay.style.width = '100vw'
    overlay.style.height = '100vh'
    overlay.style.zIndex = '99999'        // on top of everything
    overlay.style.pointerEvents = 'auto'  // ensure overlay captures all clicks
    // Stop clicks inside overlay from propagating
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        removeOverlay()  // clicking outside the box closes
      }
    })
    // Close on ESC key for keyboard/mouse users
    document.addEventListener('keydown', handleEscape, { signal: escapeController.signal })
    // Create alert box
    const box = document.createElement('div')
    box.className = 'alert-box'
    const title = document.createElement('h2')
    title.textContent = alert.event
    const description = document.createElement('p')
    if (alert.description) {
      const lines = alert.description.split('\n')
      lines.forEach((line, index) => {
        if (index > 0) {
          description.appendChild(document.createElement('br'))
        }
        description.appendChild(document.createTextNode(line))
      })
    }
    else {
      description.textContent = 'No additional details provided.'
    }

    const meta = document.createElement('p')
    meta.className = 'alert-meta'
    meta.appendChild(document.createTextNode(`Source: ${alert.sender || 'NWS'}`))
    meta.appendChild(document.createElement('br'))
    meta.appendChild(document.createTextNode(`Valid: ${this.formatAlertDateTime(alert.start)} – ${this.formatAlertDateTime(alert.end)}`))
    const closeButton = document.createElement('div')
    closeButton.className = 'alert-close'
    closeButton.textContent = 'Click to close (or press ESC)'
    // Prevent clicks inside the box from bubbling to overlay
    box.addEventListener('click', e => e.stopPropagation())
    closeButton.addEventListener('click', removeOverlay)
    box.appendChild(title)
    box.appendChild(description)
    box.appendChild(meta)
    box.appendChild(closeButton)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
  },

  formatSnowValue(snowMm, dailyForecast) {
    return this.utils.formatSnowValue(snowMm, dailyForecast, {
      units: this.config.units,
      convertSnowToDepth: this.config.convertSnowToDepth,
      snowDensityFactor: this.config.snowDensityFactor,
    })
  },
})
