import {
  AfterContentInit,
  ChangeDetectorRef,
  ContentChildren,
  Directive,
  ElementRef,
  Inject,
  Injector,
  Input,
  OnDestroy,
  OnInit,
  Optional,
  QueryList,
  Self
} from '@angular/core';
import { FormControlStatus, FormGroupDirective, NgControl, NgForm } from '@angular/forms';
import { Action, Store } from '@ngrx/store';
import {
  BehaviorSubject,
  Observable,
  asyncScheduler,
  combineLatest,
  defer,
  delay,
  distinctUntilChanged,
  distinctUntilKeyChanged,
  filter,
  from,
  fromEvent,
  map,
  merge,
  mergeMap,
  observeOn,
  pairwise,
  sampleTime,
  scan,
  startWith,
  switchMap,
  take,
  takeWhile,
  tap
} from 'rxjs';
import {
  DomObserver,
  NGYNC_CONFIG_DEFAULT,
  NGYNC_CONFIG_TOKEN,
  actionQueues,
  deepEqual,
  findProps,
  getModel,
  getSlice,
  getValue,
  intersection,
  setValue
} from '.';
import {
  AutoInit,
  AutoSubmit,
  FormActions,
  FormActionsInternal,
  FormDestroyed,
  UpdateDirty,
  UpdateErrors,
  UpdateForm,
  UpdateStatus,
  UpdateSubmitted
} from './actions';
import { Queue } from './queue';


export interface NgyncConfig {
  slice: string;
  debounceTime?: number;
  updateOn?: 'change' | 'blur' | 'submit';
}


@Directive({
  selector:
    `form:not([ngNoForm]):not([formGroup])[ngync],ng-form[ngync],[ngForm][ngync],[formGroup][ngync]`,
  exportAs: 'ngync',
})
export class SyncDirective implements OnInit, OnDestroy, AfterContentInit {
  @Input('ngync') config!: string | NgyncConfig;
  @ContentChildren(NgControl, {descendants: true}) controls!: QueryList<NgControl>;

  slice!: string;
  debounceTime!: number;
  resetOnDestroy!: string;
  updateOn!: string;

  dir!: NgForm | FormGroupDirective;
  queue!: Queue<Action>;

  _initialState: any;
  _submittedState: any;

  _blur$ = new BehaviorSubject<boolean>(false);
  _input$ = new BehaviorSubject<boolean>(false);
  _submitted$ = new BehaviorSubject<boolean>(false);
  _statusCheck$ = new BehaviorSubject<boolean>(false);
  _initialized$ = new BehaviorSubject<boolean>(false);

  _subs = {} as any;

  _blurCallback = (control: NgControl) => (value : any) => {
    this._blur$.next(true);
  };

  _inputCallback = (control: NgControl) => (value : any) => {
    control.control!.setValue(value);
    this._input$.next(true)
  };

  onInitOrUpdate$!: Observable<any>;
  onChanges$!: Observable<any>;
  onControlsChanges$!: Observable<any>;
  onSubmitOrAutoSubmit$!: Observable<any>;
  onReset$!: Observable<any>;
  onStatusChanges$!: Observable<any>;
  onActionQueued$!: Observable<any>;

  constructor(
    @Optional() @Self() @Inject(ChangeDetectorRef) public cdr: ChangeDetectorRef,
    @Optional() @Self() @Inject(ElementRef) public elRef: ElementRef,
    @Inject(Injector) public injector: Injector,
    @Inject(Store) public store: Store
  ) {
  }

  ngOnInit() {
    this.dir = this.injector.get(FormGroupDirective, null) ?? (this.injector.get(NgForm, null) as any);

    let config = this.injector.get<any>(NGYNC_CONFIG_TOKEN, {});
    config = Object.assign(NGYNC_CONFIG_DEFAULT, config);

    if(typeof this.config === 'string') {
      this.slice = this.config;
    } else {
      config = Object.assign(config, this.config);
      this.slice = config.slice;
    }

    this.debounceTime = config.debounceTime;
    this.resetOnDestroy = config.resetOnDestroy;
    this.updateOn = config.updateOn;

    if (!this.slice) {
      throw new Error('Misuse of sync directive');
    }

    if (!this.dir) {
      throw new Error('Supported form control directive not found');
    }

    actionQueues.has(this.slice) || actionQueues.set(this.slice, new Queue<Action>());
    this.queue = actionQueues.get(this.slice)!;

    let onSubmit$ = this.store.select(getSlice(this.slice)).pipe(
      map(slice => slice?.action),
      filter((action) => action?.type === FormActions.UpdateSubmitted),
      filter(value => !!value),
      map((action: any) => (UpdateSubmitted({path: this.slice, value: action.value}))),
    );

    let submit = this.elRef.nativeElement.querySelector('button[type="submit"],input[type="submit"]')
    let onAutoSubmit$ = fromEvent(submit, 'click').pipe(
      delay(0),
      filter(() => this.dir.form.valid),
      map(() => (AutoSubmit({path: this.slice})))
    )

    this.onSubmitOrAutoSubmit$ = merge(onSubmit$, onAutoSubmit$).pipe(
      filter((action: any) => action?.path === this.slice),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      mergeMap((value) => from(this._initialized$).pipe(filter(value => value), take(1), map(() => value))),
      distinctUntilKeyChanged('value'),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap((action) => { if(action.type === AutoSubmit.type) { this.store.dispatch(AutoSubmit({ path: this.slice })); } }),
      tap((action) => {

        if(action.value === true) {
          this._submittedState = this.formValue;

          if (this.dir.form.dirty) {
            this.dir.form.markAsPristine();
            this.cdr.markForCheck();
            this._submitted$.next(true);
          }
        } else {
          this._submitted$.next(false);
        }
      })
    );

    this.onInitOrUpdate$ = this.store.select(getSlice(this.slice)).pipe(
      filter(slice => [FormActions.InitForm, FormActions.UpdateForm, FormActionsInternal.AutoInit].includes(slice?.action?.type)),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap(slice => {
        let action = slice.action!.type;
        this.dir.form.patchValue(intersection(slice?.model, this.dir.form.value));

        let formValue = this.formValue;
        let equal = true;

        if(action === FormActions.InitForm || action === FormActionsInternal.AutoInit) {
          this._initialState = formValue;
          this._initialized$.next(true);

          this.dir.form.markAsPristine();
        } else {
          equal = deepEqual(formValue, this._submittedState ?? this._initialState);
          if(equal) {
            this.dir.form.markAsPristine();
          }
        }

        let submitted = this._submittedState ? equal : false;
        let dirty = !equal;

        slice.submitted !== submitted && this.store.dispatch(UpdateSubmitted({ path: this.slice, value: submitted }));
        slice.dirty !== dirty && this.store.dispatch(UpdateDirty({ path: this.slice, dirty: dirty }));

        this.dir.form.updateValueAndValidity();
        this._statusCheck$.next(true);

        this.cdr.markForCheck();
      })
    );

    this.onChanges$ = combineLatest([this._input$, this._blur$, this._submitted$]).pipe(
      filter(([input, blur, submitted]) => (input || blur || submitted)),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      mergeMap((value) => from(this._initialized$).pipe(filter(value => value), take(1), map(() => value))),
      sampleTime(this.debounceTime),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap(([input, blur, submitted]) => {

        let form = this.formValue;

        if (submitted === true || this.updateOn === 'change' && input === true || this.updateOn === 'blur' && blur === true) {
          this.store.dispatch(UpdateForm({ path: this.slice, value: form }));
        }

        if(input === true) {
          this._input$.next(false);
        }

        if(blur === true) {
          this._blur$.next(false);
        }

        if(submitted === true) {
          this._submitted$.next(false);
        }

      })
    );

    this.onControlsChanges$ = defer(() => this.controls.changes.pipe(startWith(this.controls))).pipe(
      delay(0),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      switchMap(() => from(this.store.select(getModel(this.slice))).pipe(take(1))),
      map((value) => value ?? this.formValue),
      tap(() => {
        this.controls.forEach((control: NgControl) => {
          if(control.valueAccessor) {
            control.valueAccessor.registerOnChange(this._inputCallback(control));
            control.valueAccessor.registerOnTouched(this._blurCallback(control));
          }
        });
      }),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap(value => { if(!this._initialized$.value) { this.store.dispatch(AutoInit({ path: this.slice, value: value })); } }),
      scan((acc, _) => acc + 1, 0),
      tap((value) => { if (value > 1) { this.store.dispatch(UpdateForm({ path: this.slice, value: this.formValue })); } })
    );

    this.onReset$ = this.store.select(getSlice(this.slice)).pipe(
      map(slice => slice?.action),
      filter(action => action?.type === FormActions.ResetForm),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      mergeMap((value) => from(this._initialized$).pipe(filter(value => value), take(1), map(() => value))),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap((action: any) => {
        if(action.value){
          switch(action.value) {
            case 'initial':
              this.store.dispatch(UpdateForm({ path: this.slice, value: this._initialState || {} }));
              break;
            case 'submitted':
              this.store.dispatch(UpdateForm({ path: this.slice, value: this._submittedState || {} }));
              break;
            case 'blank':
              this.store.dispatch(UpdateForm({ path: this.slice, value: this.reset(this.formValue)}));
              break;
          }
        }
      }
    ));

    this.onStatusChanges$ = this.dir.form.statusChanges.pipe(
      filter((value) => value !== 'PENDING'),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      mergeMap((value) => from(this._initialized$).pipe(filter(value => value), take(1), map(() => value))),
      map((value) => ({ status: value, errors: this.dir.form.errors})),
      pairwise(),
      distinctUntilChanged(([prev, curr]: [any, any]) => prev.status === curr.status && deepEqual(prev.errors, curr.errors)),
      map(([_, curr]) => curr),
      mergeMap((value) => from(this._statusCheck$).pipe(filter(value => value), take(1), map(() => value), tap(() => this._statusCheck$.next(false)))),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap((value) => {
        this.store.dispatch(UpdateStatus({ path: this.slice, status: value.status }));
        this.store.dispatch(UpdateErrors({ path: this.slice, errors: value.errors }));
      })
    );

    this.onActionQueued$ = this.queue.updated$.pipe(
      observeOn(asyncScheduler),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      mergeMap((value) => from(this._initialized$).pipe(filter(value => value), take(1), map(() => value))),
      takeWhile(() => DomObserver.mounted(this.elRef.nativeElement)),
      tap(() => {
        if(this.queue.initialized$.value) {
          while(this.queue.length > 0) {
            this.store.dispatch(this.queue.dequeue()!);
          }
        }
      })
    );
  }

  ngAfterContentInit() {
    let timer = setTimeout(() => {
      this.subscribe();
      clearTimeout(timer);
    }, 0);
  }

  ngOnDestroy() {
    asyncScheduler.schedule(() => {
      if(this.queue.initialized$.value) {
        while(this.queue.length > 0) {
          this.store.dispatch(this.queue.dequeue()!);
        }
      }
    });

    this.store.dispatch(FormDestroyed({ path: this.slice }));

    for (const sub of Object.keys(this._subs)) {
      this._subs[sub].unsubscribe();
    }

    this._blur$.complete();
    this._input$.complete();
    this._submitted$.complete();
    this._statusCheck$.complete();
    this._initialized$.complete();
  }

  subscribe() {
    this._subs.a = this.onInitOrUpdate$.subscribe();
    this._subs.b = this.onSubmitOrAutoSubmit$.subscribe();
    this._subs.c = this.onChanges$.subscribe();
    this._subs.d = this.onControlsChanges$.subscribe();
    this._subs.e = this.onReset$.subscribe();
    this._subs.f = this.onStatusChanges$.subscribe();
    this._subs.g = this.onActionQueued$.subscribe();
  }

  get formValue(): any {
    if(!this.controls) { return {}; }

    let value = {};
    for (const control of this.controls.toArray()) {
      value = setValue(value, control.path!.join('.'), control.value);
    }
    return value;
  }

  get formStatus(): FormControlStatus {
    return this.dir.form.status;
  }

  reset(target: any, source?: any): any {
    if(!source) { source = target; }
    for(let prop of findProps(source)) {
      let value = getValue(source, prop);
      if(typeof value === 'string') {
        target = setValue(target, prop, '');
      } else if (typeof value === 'number') {
        target = setValue(target, prop, 0);
      } else if (typeof value === 'boolean') {
        target = setValue(target, prop, false);
      } else if (typeof value === 'bigint') {
        target = setValue(target, prop, BigInt(0));
      }
    }
    return target;
  }
}
