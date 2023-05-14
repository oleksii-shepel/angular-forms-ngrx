import {Directive, forwardRef, Host, Inject, Input, OnChanges, OnDestroy, OnInit, Optional, Provider, Self, SimpleChanges, SkipSelf} from '@angular/core';
import { AsyncValidator, AsyncValidatorFn, ControlContainer, ControlValueAccessor, DefaultValueAccessor, Form, FormArray, FormArrayName, FormControlDirective, FormGroup, FormGroupDirective, FormGroupName, NG_ASYNC_VALIDATORS, NG_VALIDATORS, NG_VALUE_ACCESSOR, NgControl, NgForm, SetDisabledStateOption, Validator, ValidatorFn } from '@angular/forms';
import { composeAsyncValidators, composeValidators } from '../shared/validators';
import { CALL_SET_DISABLED_STATE } from '../shared/controls';
import { selectValueAccessor } from './accessors';
import { FieldGroupDirective } from './group.directive';

const formControlBinding: Provider = {
  provide: ControlContainer,
  useExisting: forwardRef(() => FieldArrayDirective)
};

@Directive({selector: '[ngFieldArray]', providers: [formControlBinding]})
export class FieldArrayDirective extends ControlContainer implements OnInit, OnDestroy, NgControl {
  /** @internal */
  _parent: ControlContainer;

  /**
   * @description
   * Tracks the name of the `FormArray` bound to the directive. The name corresponds
   * to a key in the parent `FormGroup` or `FormArray`.
   * Accepts a name as a string or a number.
   * The name in the form of a string is useful for individual forms,
   * while the numerical form allows for form arrays to be bound
   * to indices when iterating over arrays in a `FormArray`.
   */
  @Input('ngFieldArray') override name: string = '';
  private _rawValidators!: (ValidatorFn | Validator)[];
  private _composedValidator!: ValidatorFn | null;
  private _rawAsyncValidators!: (AsyncValidator | AsyncValidatorFn)[];
  private _composedAsyncValidator!: AsyncValidatorFn | null;
  private _onCollectionChange!: () => void;
  private _form!: FormArray<any>;
  constructor(
      @Optional() @Host() @SkipSelf() parent: ControlContainer,
      @Optional() @Self() @Inject(NG_VALIDATORS) validators: (Validator|ValidatorFn)[],
      @Optional() @Self() @Inject(NG_ASYNC_VALIDATORS) asyncValidators:
          (AsyncValidator|AsyncValidatorFn)[]) {
    super();
    this._parent = parent;
    this._setValidators(validators);
    this._setAsyncValidators(asyncValidators);
    this._form = new FormArray<any>([], this._composedValidator, this._composedAsyncValidator);

    Object.assign(FormArray.prototype, this._form, { registerControl: (name: string, control: any) => {
        if (this._form.controls[name as any]) return;
        this._form.controls[name as any] = control;
        control.setParent(this._form);
        control._registerOnCollectionChange(this._onCollectionChange);
        return control;
    } });
  }

  valueAccessor!: ControlValueAccessor | null;

  viewToModelUpdate(newValue: any): void {
    throw new Error('Method not implemented.');
  }

  /**
   * A lifecycle method called when the directive's inputs are initialized. For internal use only.
   * @throws If the directive does not have a valid parent.
   * @nodoc
   */
  ngOnInit(): void {
    if(this.formDirective instanceof NgForm) {
      this.formDirective!.form.addControl(this.name, this._form);
    } else if(this.formDirective instanceof FieldGroupDirective) {
      this.formDirective.formDirective!.addControl(this);
    }
  }

  setParent(parent: ControlContainer): void {
    this._parent = parent;
  }

  _registerOnCollectionChange(fn: () => void): void {
    this._onCollectionChange = fn;
  }

  /**
   * A lifecycle method called before the directive's instance is destroyed. For internal use only.
   * @nodoc
   */
  ngOnDestroy(): void {
    if (this.formDirective) {
      this.formDirective.removeControl(this.control);
    }
  }

  /**
   * @description
   * The `FormArray` bound to this directive.
   */
  override get control(): FormArray | null {
    if(this.formDirective instanceof NgForm) {
      return this.formDirective!.controls[this.name] as FormArray;
    } else if(this.formDirective instanceof FieldGroupDirective) {
      return this.formDirective.control.get(this.name) as FormArray;
    }
    return null;
  }

  /**
   * @description
   * The top-level directive for this group if present, otherwise null.
   */
  override get formDirective(): any {
    return this._parent ? <any>this._parent.formDirective : null;
  }

  /**
   * @description
   * Returns an array that represents the path from the top-level form to this control.
   * Each index is the string name of the control on that level.
   */
  override get path(): string[] {
    return [...this._parent.path!, this.name.toString()];
  }

  private _checkParentType(): void {
  }

  /**
   * Sets synchronous validators for this directive.
   * @internal
   */
  private _setValidators(validators: Array<Validator|ValidatorFn>|undefined): void {
    this._rawValidators = validators || [];
    this._composedValidator = composeValidators(this._rawValidators);
  }

  /**
   * Sets asynchronous validators for this directive.
   * @internal
   */
  private _setAsyncValidators(validators: Array<AsyncValidator|AsyncValidatorFn>|undefined): void {
    this._rawAsyncValidators = validators || [];
    this._composedAsyncValidator = composeAsyncValidators(this._rawAsyncValidators);
  }

}

function _hasInvalidParent(parent: ControlContainer): boolean {
  return !(parent instanceof FormGroupName) && !(parent instanceof FormGroupDirective) &&
      !(parent instanceof FormArrayName);
}