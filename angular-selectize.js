/**
 * Directive to convert a select into a selectize.js hybrid textbox and <select>
 * Supports an ngOptions expression. Tested with:
 *  `label for value in array`
 *  `select as label for value in array`
 * In theory supports the same options as selectize.js
 *
 * Usage:
 * <select
 *   multiple
 *   ng-model="selected"
 *   ng-options="option.id as option.name for option in options"
 *   selectize="{ plugins: ['remove_button'], create: 'true' }">
 * </select>
 *
 * Attributes:
 *   multiple: Converts the select into text input of tags
 *
 * (c) 2014 Evan Oxfeld https://github.com/EvanOxfeld/angular-selectize.js
 * License: MIT
 **/

(function (angular) {
    'use strict';

    angular.module('selectize', [])

        .directive('selectize', ['$parse', '$timeout', function ($parse, $timeout) {
            var NG_OPTIONS_REGEXP = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?\s+for\s+(?:([\$\w][\$\w]*)|(?:\(\s*([\$\w][\$\w]*)\s*,\s*([\$\w][\$\w]*)\s*\)))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?$/;

            return {
                scope: {
                    multiple: '@',
                    opts: '@selectize'
                },
                require: '?ngModel',
                link: function (scope, element, attrs, ngModelCtrl) {
                    var opts = scope.$parent.$eval(scope.opts) || {};
                    var initializing = false;
                    var modelUpdate = false;
                    var optionsUpdate = false;
                    var isFirstOptionsBinding = true;
                    var selectize, newModelValue, newOptions, updateTimer;

                    watchModel();

                    if (attrs.ngDisabled) {
                        watchParentNgDisabled();
                    }

                    if (!attrs.ngOptions) {
                        return;
                    }

                    var match = attrs.ngOptions.match(NG_OPTIONS_REGEXP);
                    var valueName = match[4] || match[6];
                    var optionsExpression = match[7];
                    var optionsFn = $parse(optionsExpression);
                    var displayFn = $parse(match[2] || match[1]);
                    var valueFn = $parse(match[2] ? match[1] : valueName);
                    var track = match[8]
                    var trackFn = track ? $parse(match[8]) : null;

                    watchParentOptions();

                    function watchModel () {
                        scope.$watchCollection(function () {
                            return ngModelCtrl.$modelValue;
                        }, function (modelValue) {
                            newModelValue = modelValue;
                            modelUpdate = true;
                            if (!updateTimer) {
                                scheduleUpdate();
                            }
                        });
                    }

                    function watchParentOptions () {
                        scope.$parent.$watchCollection(optionsExpression, function (options) {
                            newOptions = options || [];
                            optionsUpdate = true;
                            if (!updateTimer) {
                                scheduleUpdate();
                            }
                        });
                    }

                    function watchParentNgDisabled () {
                        scope.$parent.$watch(attrs.ngDisabled, function (isDisabled) {
                            if (selectize) {
                                isDisabled ? selectize.disable() : selectize.enable();
                            }
                        });
                    }

                    function scheduleUpdate () {
                        if (!selectize) {
                            if (!initializing) {
                                initSelectize();
                            }
                            return;
                        }

                        updateTimer = $timeout(function () {
                            var model = newModelValue;
                            var options = newOptions;
                            var selectizeOptions = Object.keys(selectize.options);
                            var selectedItems = getSelectedItems(model);
                            if (optionsUpdate) {
                                for (var i = 0; i < selectizeOptions.length; i++) {
                                    if(selectizeOptions[i] !== '?' && selectizeOptions[i] !== model){
                                        selectize.removeOption(selectizeOptions[i]);
                                    }
                                }
                                selectize.load(function (cb) {
                                    var mappedOptions = options.map(function (option, index) {
                                        var value = getOptionValue(option);
                                        var item = {
                                            text: getOptionLabel(option),
                                            value: value
                                        };
                                        // So selected items can be first ones in list (not sorted by label)
                                        if (selectedItems.indexOf(value) !== -1) {
                                            item.selected = 1;
                                        }
                                        return item;
                                    });

                                    $timeout(function () {
                                        //console.log('set value', model);
                                        if (selectize.getOption(model).length > 0) {
                                            selectize.setValue(model);
                                            if (selectize.getOption('?').length > 0) {
                                                selectize.removeOption('?');
                                            }
                                        }
                                        else if (selectize.hasOptions && selectize.getOption('?').length > 0) {
                                            selectize.removeOption('?');
                                        }
                                        else if (model === null) {
                                            selectize.clear();
                                            selectize.removeOption('');
                                        }
                                    }, 100);
                                    cb(mappedOptions);
                                });
                            }

                            if (modelUpdate || optionsUpdate) {
                                if (isFirstOptionsBinding) {
                                    isFirstOptionsBinding = false;
                                    selectedItems.forEach(function (item) {
                                        selectize.addItem(item);
                                    });

                                    var $option = selectize.getOption(0);
                                    if ($option) {
                                        selectize.setActiveOption($option);
                                    }
                                }

                                if (model === undefined || model === null) {
                                    selectize.clear();
                                }
                            }

                            modelUpdate = optionsUpdate = false;
                            updateTimer = null;
                        });
                    }

                    function initSelectize () {
                        initializing = true;
                        scope.$evalAsync(function () {
                            initializing = false;

                            opts.onInitialize = selectizeInitialize;

                            element.selectize(opts);
                            selectize = element[0].selectize;
                            if (attrs.ngOptions) {
                                if (scope.multiple) {
                                    selectize.on('item_add', onItemAddMultiSelect);
                                    selectize.on('item_remove', onItemRemoveMultiSelect);
                                } else if (opts.create) {
                                    selectize.on('item_add', onItemAddSingleSelect);
                                }
                            }
                            selectize.on('change', updateAngularValue);
                            // If there's no selectize.load() needed then set model value here
                            $timeout(function () {
                                selectize.refreshOptions(false);
                                if (selectize.getOption(newModelValue).length > 0) {
                                    selectize.setValue(newModelValue);
                                    if (selectize.getOption('?').length > 0) {
                                        selectize.removeOption('?');
                                    }
                                }
                            });
                        });
                    }

                    function initSelectizeValue (modelValue) {
                        if(selectize.options[modelValue] !== undefined){
                            //selectize.setValue(modelValue);
                            if (selectize.getOption('?').length > 0) {
                                selectize.removeOption('?');
                            }
                        }
                        else if (selectize.hasOptions && selectize.getOption('?').length > 0) {
                            selectize.removeOption('?');
                        }
                        else if (modelValue === null) {
                            selectize.clear();
                            selectize.removeOption('');
                        }
                    }

                    function updateAngularValue (val) {
                        if (val === '') {
                            val = null;
                        }
                        if (angular.equals(val, ngModelCtrl.$viewValue)) {
                            return;
                        }

                        newModelValue = val;

                        scope.$evalAsync(function () {
                            ngModelCtrl.$setViewValue(val);
                            //console.log('update Angular', val);
                        });
                    }

                    function selectizeInitialize () {
                        selectize = this;
                        $timeout(function () {
                            if (Array.isArray(newModelValue)) {
                                selectize.setValue(newModelValue);
                            } else {
                                initSelectizeValue(newModelValue);
                            }
                        });
                    }

                    function onItemAddMultiSelect (value, $item) {
                        var model = ngModelCtrl.$viewValue || [];
                        var options = optionsFn(scope.$parent);
                        var option = options[value];
                        value = option ? getOptionValue(option) : value;

                        if (model.indexOf(value) === -1) {
                            model.push(value);

                            if (!option && opts.create && options.indexOf(value) === -1) {
                                options.push(value);
                            }
                            scope.$evalAsync(function () {
                                ngModelCtrl.$setViewValue(model);
                            });
                        }
                    }

                    function onItemAddSingleSelect (value, $item) {
                        var model = ngModelCtrl.$viewValue;
                        var options = optionsFn(scope.$parent);
                        var option = options[value];
                        value = option ? getOptionValue(option) : value;

                        if (model !== value) {
                            model = value;

                            if (!option && options.indexOf(value) === -1) {
                                options.push(value);
                            }
                            scope.$evalAsync(function () {
                                ngModelCtrl.$setViewValue(model);
                            });
                        }
                    }

                    function onItemRemoveMultiSelect (value) {
                        var model = ngModelCtrl.$viewValue;
                        var options = optionsFn(scope.$parent);
                        var option = options[value];
                        value = option ? getOptionValue(option) : value;

                        var index = model.indexOf(value);
                        if (index >= 0) {
                            model.splice(index, 1);
                            scope.$evalAsync(function () {
                                ngModelCtrl.$setViewValue(model);
                            });
                        }
                    }

                    function getSelectedItems (model) {
                        model = angular.isArray(model) ? model : [model] || [];

                        if (!attrs.ngOptions) {
                            return model.map(function (i) {
                                return selectize.options[i] ? selectize.options[i].value : ''
                            });
                        }

                        var options = optionsFn(scope.$parent);

                        if (!options) {
                            return [];
                        }

                        var selections = options.reduce(function (selected, option, index) {
                            var optionValue = getOptionValue(option);
                            if (model.indexOf(optionValue) >= 0) {
                                selected[optionValue] = optionValue;
                            }
                            return selected;
                        }, {});
                        return Object
                            .keys(selections)
                            .map(function (key) {
                                return selections[key];
                            });
                    }

                    function getOptionValue (option) {
                        var optionContext = {};
                        optionContext[valueName] = option;
                        return valueFn(optionContext);
                    }

                    function getOption (option) {
                        var optionContext = {};
                        optionContext[valueName] = option;
                        return valueFn(optionContext);
                    }

                    function getOptionLabel (option) {
                        var optionContext = {};
                        optionContext[valueName] = option;
                        return displayFn(optionContext);
                    }

                    scope.$on('$destroy', function () {
                        if (updateTimer) {
                            $timeout.cancel(updateTimer);
                        }
                    });
                }
            };
        }]);
})(angular);
