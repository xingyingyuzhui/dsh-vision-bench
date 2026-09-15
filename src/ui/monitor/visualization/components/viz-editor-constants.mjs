// Shared option constants for the visualization editor drawer.

export const P = (s) => s.split(',').map((x) => x.split(':'))
export const SIZES = P('11:11 px,12:12 px,14:14 px')
export const POS_OPTS = P('top:顶部,bottom:底部,left:左侧,right:右侧')
export const DEC_OPTS = P(':自动,0:0位,1:1位,2:2位,3:3位')
export const TIME_WINDOWS = P('60000:1分钟,300000:5分钟,900000:15分钟,1800000:30分钟,3600000:1小时')
export const TYPE_DEFS = P('line:折线图:时序趋势,bar:柱状图:瞬时对比,value:数值卡:实时数值,switch:控制开关:线圈控制')
