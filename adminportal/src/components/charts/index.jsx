import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDate, formatNumber } from '../../utils/format'

export const CHART_COLORS = {
  primary: '#2563eb',
  teal: '#0d9488',
  amber: '#d97706',
  red: '#dc2626',
  indigo: '#4f46e5',
  slate: '#a1a1aa',
  green: '#16a34a',
  violet: '#7c3aed',
}

const axisTick = { fill: 'var(--chart-text)', fontSize: 11.5, fontWeight: 500 }

export function ChartTooltip({ active, payload, label, formatter, suffix = '', labelPrefix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      {label !== undefined && (
        <p className="chart-tooltip-label">
          {labelPrefix}
          {label}
        </p>
      )}
      {payload.map((entry) => (
        <div className="chart-tooltip-row" key={entry.dataKey || entry.name}>
          <span
            className="chart-tooltip-dot"
            style={{ background: entry.color || entry.fill || entry.payload?.color }}
          />
          <span className="chart-tooltip-name">{entry.name}</span>
          <strong>
            {formatter ? formatter(entry.value, entry) : formatNumber(entry.value)}
            {suffix}
          </strong>
        </div>
      ))}
    </div>
  )
}

export function StorageTrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          dy={10}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={(value) => `${value}%`}
          width={52}
        />
        <Tooltip
          content={<ChartTooltip suffix="%" formatter={(value) => Number(value).toFixed(1)} />}
          cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '4 4' }}
        />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="storage"
          name="Average storage"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.6}
          fill={CHART_COLORS.primary}
          fillOpacity={0.12}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function DistrictFarmersChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, left: 0, bottom: 2 }}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis type="number" domain={[0, 'dataMax']} hide />
        <YAxis
          type="category"
          dataKey="district"
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          width={94}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={
            <ChartTooltip />
          }
        />
        <Bar isAnimationActive={false}
          dataKey="farmers"
          name="Registered farmers"
          radius={[0, 5, 5, 0]}
          barSize={11}
        >
          {data.map((entry) => (
            <Cell key={entry.district} fill={CHART_COLORS.teal} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// Highest rainfall reported each day (bars) and how many reservoirs spilled (line)
export function RainfallSpillChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: -6, left: -22, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} dy={10} interval={2} />
        <YAxis
          yAxisId="rain"
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          width={46}
          tickFormatter={(value) => `${value}`}
        />
        <YAxis yAxisId="spill" orientation="right" hide allowDecimals={false} domain={[0, (max) => Math.max(4, max * 1.4)]} />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ fill: 'var(--surface-2)' }}
        />
        <Bar isAnimationActive={false}
          yAxisId="rain"
          dataKey="rainfall"
          name="Highest rainfall (mm)"
          fill={CHART_COLORS.indigo}
          radius={[4, 4, 0, 0]}
          barSize={12}
         
        />
        <Line isAnimationActive={false}
          yAxisId="spill"
          type="monotone"
          dataKey="spilling"
          name="Reservoirs spilling"
          stroke={CHART_COLORS.amber}
          strokeWidth={2.2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function StatusDonut({ data, total, centerLabel = 'Reservoirs', size = 208 }) {
  return (
    <div className="donut-wrap" style={{ maxWidth: size }}>
      <ResponsiveContainer width="100%" height={size}>
        <PieChart>
          <Pie isAnimationActive={false}
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="68%"
            outerRadius="96%"
            paddingAngle={3}
            cornerRadius={6}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((entry) => (
              <Cell key={entry.key} fill={CHART_COLORS[entry.color] || entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={(value) => formatNumber(value)} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center">
        <strong>{formatNumber(total)}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  )
}

// warning is the gauge's alert level
export function RiverHydrograph({ data, warning, major }) {
  // warning/major are null for gauges without flood levels: no lines, axis fits the data
  const levels = data.map((point) => point.level).filter((level) => level !== null)
  const maxValue = Math.max((major ?? 0) + 0.8, ...levels, 1)
  // Some gauges read below 0 m (their datum is above the low-water bed), so the axis must go below 0 for them
  const minValue = Math.min(0, ...levels.map((level) => Math.floor((level - 0.2) * 2) / 2))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 18, right: 14, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis
          dataKey="time"
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          dy={10}
          interval={3}
        />
        <YAxis
          domain={[minValue, Number(maxValue.toFixed(1))]}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          width={48}
          tickFormatter={(value) => `${Number(value).toFixed(1)}m`}
        />
        <Tooltip
          content={<ChartTooltip suffix=" m" formatter={(value) => Number(value).toFixed(2)} />}
          cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '4 4' }}
        />
{warning !== null && (
        <ReferenceLine
          y={warning}
          stroke={CHART_COLORS.amber}
          strokeDasharray="6 4"
          strokeWidth={1.4}
          label={{
            value: `Alert ${warning.toFixed(1)}m`,
            position: 'insideTopRight',
            fill: CHART_COLORS.amber,
            fontSize: 10.5,
            fontWeight: 600,
          }}
        />
        )}{major !== null && (
        <ReferenceLine
          y={major}
          stroke={CHART_COLORS.red}
          strokeDasharray="6 4"
          strokeWidth={1.4}
          label={{
            value: `Major flood ${major.toFixed(1)}m`,
            position: 'insideBottomRight',
            fill: CHART_COLORS.red,
            fontSize: 10.5,
            fontWeight: 600,
          }}
        />
        )}
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="level"
          name="Water level"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.6}
          fill={CHART_COLORS.primary}
          fillOpacity={0.12}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function SmsVolumeChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 12, right: 4, left: -16, bottom: 0 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} dy={10} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          width={46}
          tickFormatter={(value) => (value >= 1000 ? `${value / 1000}k` : value)}
        />
        <Tooltip
          content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
          cursor={{ fill: 'var(--surface-2)' }}
        />
        <Bar isAnimationActive={false} dataKey="delivered" name="Sent" stackId="a" fill={CHART_COLORS.primary} radius={[3, 3, 0, 0]} barSize={16} />
        <Bar isAnimationActive={false} dataKey="failed" name="Failed" stackId="a" fill={CHART_COLORS.red} radius={[3, 3, 0, 0]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function FarmerGrowthChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={axisTick} dy={10} />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} width={50} />
        <Tooltip content={<ChartTooltip formatter={(value) => formatNumber(value)} />} />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="farmers"
          name="New registrations"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.3}
          fill={CHART_COLORS.primary}
          fillOpacity={0.12}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="active"
          name="Activated"
          stroke={CHART_COLORS.indigo}
          strokeWidth={1.6}
          strokeDasharray="4 4"
          fill="none"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function CropDonut({ data, total, centerLabel = 'Farmers' }) {
  return (
    <div className="donut-wrap donut-sm">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie isAnimationActive={false}
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="94%"
            paddingAngle={2}
            cornerRadius={4}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip suffix="%" />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center">
        <strong>{total}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  )
}

export function FlowSparkChart({ data, color = CHART_COLORS.primary }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
        <Line isAnimationActive={false}
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export const FORECAST_THRESHOLDS = { low: 30, spill: 100 }

const dayTime = (date) => Date.parse(`${date}T00:00:00`)
const shortDay = (time) => formatDate(new Date(time), { day: 'numeric', year: undefined })

function ForecastTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  const fill = point.predicted !== undefined && point.level === undefined ? point.predicted : point.level
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">
        {formatDate(point.date, { year: undefined })}
        {point.isTarget ? ' · predicted' : point.isToday ? ' · latest' : ''}
      </p>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-dot" style={{ background: point.isTarget ? CHART_COLORS.violet : CHART_COLORS.primary }} />
        <span className="chart-tooltip-name">Fill</span>
        <strong>{fill === null || fill === undefined ? 'No reading' : `${Number(fill).toFixed(1)}%`}</strong>
      </div>
      {point.storage !== null && point.storage !== undefined && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: 'var(--border-strong)' }} />
          <span className="chart-tooltip-name">Storage</span>
          <strong>{formatNumber(point.storage)} AF</strong>
        </div>
      )}
      {!point.isTarget && point.rain !== null && point.rain !== undefined && (
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: CHART_COLORS.indigo }} />
          <span className="chart-tooltip-name">Rainfall</span>
          <strong>{point.rain} mm</strong>
        </div>
      )}
    </div>
  )
}

// Observed fill (solid) and the model's 14-day prediction (dashed), with spill and low-water lines,
// like the farmer portal's forecast chart. `forecast` is the API's forecast response (`data`).
export function ReservoirForecastChart({ forecast }) {
  const points = forecast.history.map((h) => ({
    t: dayTime(h.date),
    date: h.date,
    level: h.fill_pct,
    storage: h.storage_acft,
    rain: h.rain_mm,
  }))
  const today = points.at(-1)
  if (today) {
    today.isToday = true
    today.predicted = today.level // the dashed line starts at the latest reading
  }
  const next = Number((forecast.predicted_fill_in_14d * 100).toFixed(1))
  const targetTime = dayTime(forecast.target_date)
  points.push({
    t: targetTime,
    date: forecast.target_date,
    predicted: next,
    storage: forecast.predicted_storage_in_14d_acft,
    isTarget: true,
  })

  const highest = Math.max(next, ...points.map((p) => p.level ?? 0))
  const top = Math.max(110, Math.ceil((highest + 5) / 10) * 10) // fill passes 100% while a tank spills
  const first = points[0].t
  const ticks = [first, first + (today.t - first) / 2, today.t, targetTime]

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={points} margin={{ top: 16, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 6" />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={ticks}
          tickFormatter={shortDay}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          dy={10}
        />
        <YAxis
          domain={[0, top]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tick={axisTick}
          tickFormatter={(value) => `${value}%`}
          width={52}
        />
        <Tooltip content={<ForecastTooltip />} cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '4 4' }} />
        <ReferenceLine
          y={FORECAST_THRESHOLDS.spill}
          stroke={CHART_COLORS.red}
          strokeDasharray="6 4"
          strokeWidth={1.4}
          label={{ value: `Spill ${FORECAST_THRESHOLDS.spill}%`, position: 'insideTopLeft', fill: CHART_COLORS.red, fontSize: 10.5, fontWeight: 600 }}
        />
        <ReferenceLine
          y={FORECAST_THRESHOLDS.low}
          stroke={CHART_COLORS.amber}
          strokeDasharray="6 4"
          strokeWidth={1.4}
          label={{ value: `Low ${FORECAST_THRESHOLDS.low}%`, position: 'insideBottomLeft', fill: CHART_COLORS.amber, fontSize: 10.5, fontWeight: 600 }}
        />
        <ReferenceLine
          x={today.t}
          stroke="var(--border-strong)"
          strokeDasharray="2 4"
          label={{ value: 'Today', position: 'top', fill: 'var(--chart-text)', fontSize: 10.5, fontWeight: 600 }}
        />
        <Area isAnimationActive={false}
          type="monotone"
          dataKey="level"
          name="Observed"
          stroke={CHART_COLORS.primary}
          strokeWidth={2.4}
          fill={CHART_COLORS.primary}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
        />
        <Line isAnimationActive={false}
          type="linear"
          dataKey="predicted"
          name="Predicted"
          stroke={CHART_COLORS.violet}
          strokeWidth={2.4}
          strokeDasharray="6 4"
          connectNulls
          dot={false}
          activeDot={false}
        />
        <ReferenceDot x={today.t} y={today.level} r={4.5} fill={CHART_COLORS.primary} stroke="var(--surface)" strokeWidth={2} />
        <ReferenceDot x={targetTime} y={next} r={5} fill={CHART_COLORS.violet} stroke="var(--surface)" strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
