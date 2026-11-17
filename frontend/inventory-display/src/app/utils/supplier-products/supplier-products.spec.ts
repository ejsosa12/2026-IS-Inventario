import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SupplierProducts } from './supplier-products';

describe('SupplierProducts', () => {
  let component: SupplierProducts;
  let fixture: ComponentFixture<SupplierProducts>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupplierProducts],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SupplierProducts);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
