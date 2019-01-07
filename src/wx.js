import extend from 'extend';
import {
    appendUrl,
    invokePageMethod
} from './util.js';

/**
 * 如果跳转失败, 则尝试降级(degrade)到降级的方法(例如 `switchTab`)来完成跳转
 * 
 * @param {object} degradeFunctionName 降级的方法名
 * @return {function} function(options)
 */
function failThenTryDegrade(degradeFunctionName) {
    return function(options) {
        var originalFail = options.fail;
        var originalUrl = options.url;
        function tryDegrade() {
            var _options = extend({}, options);

            // 调用过 `wx` 的跳转方法后, 会改写 `options.url` 参数
            // 例如 `url` 原始值为 `/pages/home/index?a=1`
            // 会被改写为 `pages/home/index.html?a=1`
            _options.url = originalUrl;

            // 如果降级的方法也调用失败了, 才触发失败回调
            if (originalFail) {
                _options.fail = originalFail;
            } else {
                // 删除用于降级的 fail 回调
                delete _options.fail;
            }

            wx[degradeFunctionName](_options);
        }

        options.fail = function(result) {
            // XXX 微信小程序没有提供错误码用于判定是想跳转到 tabbar 页面却用错了方法
            // 例如: `navigateTo:fail can not navigateTo a tabbar page`
            console.warn(result.errMsg);
            if (originalUrl) {
                // 标记尝试使用降级的方法来跳转页面
                options._tryDegrade = degradeFunctionName;
                tryDegrade();
            }
        };
    };
}

var failThenTrySwitchTab = failThenTryDegrade('switchTab');
var failThenTryRedirectTo = failThenTryDegrade('redirectTo');

// 包装 wx 的方法

/**
 * 封装原生的 navigateTo 方法
 * 
 * - 扩展 `_urlParams` 用于在 URL 上追加参数
 * - 调用失败时尝试降级为 `switchTab` 来完成跳转
 * - 解决微信小程序只允许跳转 10 层路由的问题, 超过限制后自动变为 `redirectTo` 跳转页面
 * 
 * @param {object} options
 *                 options._urlParams {object} 需要追加到 URL 上的参数
 */
export function navigateTo(options) {
    var _options = extend({}, options);

    if (_options._urlParams) {
        _options.url = appendUrl(_options.url, _options._urlParams);
    }

    failThenTrySwitchTab(_options);

    // 最多 10 次路由(首页本身也算一次)
    if (getCurrentPages().length < 10) {
        return wx.navigateTo(_options);
    } else {
        return wx.redirectTo(_options);
    }
};

/**
 * 封装原生的 redirectTo 方法
 * 
 * - 扩展 `_urlParams` 用于在 URL 上追加参数
 * - 调用失败时尝试降级为 `switchTab` 来完成跳转
 * 
 * @param {object} options
 *                 options._urlParams {object} 需要追加到 URL 上的参数
 */
export function redirectTo(options) {
    var _options = extend({}, options);

    if (_options._urlParams) {
        _options.url = appendUrl(_options.url, _options._urlParams);
    }

    failThenTrySwitchTab(_options);
    return wx.redirectTo(_options);
};

/**
 * 封装原生的 `switchTab` 方法
 * 
 * - 调用失败时尝试降级为 `redirectTo` 来完成跳转
 * 
 * @param {object} options
 */
export function switchTab(options) {
    failThenTryRedirectTo(options);
    return wx.switchTab(options);
};

/**
 * 封装原生的 navigateBack 方法
 * 
 * - 回退页面时调用回退页的特定方法
 * - 判断预期返回的页面
 * 
 * @param {object} options
 *                 options._triggerOnNavigateBack {boolean|string} 激活时默认调用回退页中的 _onNavigateBack 方法, 如果传入的是字符串则表示方法名, 指定调用回退页面中的该方法
 *                 options._onNavigateBackArgs {array<any>} 传入 _onNavigateBack 方法的参数
 *                 options._expectedBackUrl {string} 预期返回的页面 URL
 */
export function navigateBack(options = {}) {
    var _options = extend({}, options);

    // 包装成功方法
    _options.success = options.success;
    if (_options._triggerOnNavigateBack) {
        _options.success = function() {
            options.success && options.success();

            var methodName = typeof _options._triggerOnNavigateBack === 'boolean' ?
                             '_onNavigateBack' : _options._triggerOnNavigateBack;
            invokePageMethod(methodName, [_options._onNavigateBackArgs]);
        };
    }

    // 预期返回的页面
    if (_options._expectedBackUrl) {
        var pages = getCurrentPages();

        if (pages.length === 1) { // 没有上一页
            _options.url = _options._expectedBackUrl;
            // XXX tabbar 的页面算是第一个页面
            return navigateTo(_options);
        } else {
            var delta = isNaN(parseInt(_options.delta)) ? 1 : parseInt(_options.delta);
            if (delta >= pages.length) { // 首页
                delta = pages.length - 1;
            } else if (delta <= 0) { // 上一页
                delta = 1;
            }

            // 需要排掉当前页
            var backPage = pages[pages.length - (delta + 1)];

            // 回退的页面符合预期直接回退
            if (backPage.route.indexOf(_options._expectedBackUrl) != -1) {
                return wx.navigateBack(_options);
            } else { // 不符合预期则跳转到预期页面
                _options.url = _options._expectedBackUrl;
                return navigateTo(_options);
            }
        }
    } else { // 兜底
        return wx.navigateBack(_options);
    }
};